/**
 * Event-loop freeze watchdog.
 *
 * The backend has been observed to wedge at ~100% CPU on one core with a fully
 * blocked event loop — every request (even GET /api/health) hangs, and the
 * frontend sticks on "Starting…". The block is data-dependent, so it can't be
 * pinned by reading code; we have to capture the JS stack AT THE MOMENT it freezes.
 *
 * A normal in-process timer can't do that: if the main thread is spinning, no
 * JS on the main thread runs, so it can't report on itself. This watchdog gets
 * around that with TWO things that live outside the main thread:
 *
 *   1. A heartbeat the main thread stamps into a SharedArrayBuffer on a libuv
 *      timer. When the loop is blocked the stamp stops advancing.
 *   2. A Worker thread (its own event loop, never blocked) that watches the gap.
 *      When the gap crosses the threshold it attaches to this process's V8
 *      inspector over CDP and issues Debugger.pause — which interrupts even a
 *      tight JS loop at the next safepoint — then logs the paused call frames.
 *
 * Output goes to logs/eventloop-block.log (and stderr). The TOP frame in that
 * dump is the line that was spinning. Opt-in via env; on by default in dev.
 */
import inspector from 'inspector';
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';

let started = false;

export function startEventLoopWatchdog(opts: { thresholdMs?: number; logDir?: string } = {}): void {
  if (started) return;
  started = true;

  const thresholdMs = opts.thresholdMs ?? parseInt(process.env.WATCHDOG_THRESHOLD_MS || '5000', 10);
  const logDir = opts.logDir ?? path.join(process.cwd(), 'logs');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch { /* ignore */ }

  // Open the V8 inspector on a random loopback port so the worker can attach.
  // (false = don't wait for a debugger to connect.) Harmless if already open.
  try {
    if (!inspector.url()) inspector.open(0, '127.0.0.1', false);
  } catch (e) {
    console.error('[watchdog] could not open inspector — freeze stacks will be unavailable:', (e as Error).message);
    return;
  }
  const inspectorUrl = inspector.url();
  if (!inspectorUrl) {
    console.error('[watchdog] inspector URL unavailable — watchdog disabled');
    return;
  }

  // 1 float64 = the last time (ms) the main thread was alive.
  const sab = new SharedArrayBuffer(8);
  const beat = new Float64Array(sab);
  beat[0] = Date.now();
  const beatTimer = setInterval(() => { beat[0] = Date.now(); }, 500);
  beatTimer.unref(); // never keep the process alive just for the heartbeat

  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { sab, thresholdMs, logDir, inspectorUrl },
  });
  worker.unref();
  worker.on('error', (err) => console.error('[watchdog] worker error:', err.message));

  console.log(`[watchdog] event-loop freeze watchdog active (threshold ${thresholdMs}ms, log → ${path.join(logDir, 'eventloop-block.log')})`);
}

// Runs in a separate thread — uses only Node built-ins + the global WebSocket
// (available in Node 21+). Speaks the Chrome DevTools Protocol to the main
// thread's inspector to grab a stack while the main thread is frozen.
const WORKER_SOURCE = `
const { workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { sab, thresholdMs, logDir, inspectorUrl } = workerData;
const beat = new Float64Array(sab);
const logFile = path.join(logDir, 'eventloop-block.log');

// Don't watch during the first 20s: ts-node compiles TypeScript synchronously on
// boot, which legitimately blocks the loop for several seconds and is NOT the bug.
const START_AT = Date.now() + 20000;
// After capturing one stack, wait this long before capturing again. Pausing the
// debugger to read the stack itself stalls the heartbeat, so without a cooldown the
// pause would look like a fresh freeze and re-trigger forever (the "Debugger attached
// / Debugger ending" spam).
const COOLDOWN_MS = 60000;
let lastCaptureAt = 0;

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\\n';
  try { fs.appendFileSync(logFile, line); } catch (e) {}
  try { process.stderr.write('\\n[watchdog] ' + msg + '\\n'); } catch (e) {}
}

let capturing = false;

function captureStack(gap) {
  if (capturing) return;
  capturing = true;

  let ws;
  let done = false;
  const finish = (why) => {
    if (done) return;
    done = true;
    try { if (ws) ws.close(); } catch (e) {}
    capturing = false;
    if (why) log(why);
  };

  try {
    ws = new WebSocket(inspectorUrl);
  } catch (e) {
    return finish('stack capture failed to open socket: ' + (e && e.message));
  }

  let id = 0;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method: method, params: params || {} }));

  ws.addEventListener('open', () => {
    send('Debugger.enable');
    send('Debugger.pause');
  });
  ws.addEventListener('error', () => finish('stack capture socket error'));
  ws.addEventListener('message', (ev) => {
    let data;
    try { data = JSON.parse(ev.data); } catch (e) { return; }
    if (data.method === 'Debugger.paused') {
      const frames = (data.params.callFrames || []).slice(0, 25).map((f, i) => {
        const loc = f.location || {};
        const url = (f.url || '?').replace(/^file:\\/\\/\\//, '').replace(/^file:\\/\\//, '');
        return '  #' + i + '  ' + (f.functionName || '(anonymous)') + '  ->  ' + url + ':' + ((loc.lineNumber || 0) + 1);
      }).join('\\n');
      log('MAIN THREAD BLOCKED ~' + gap + 'ms. JS stack at the block (top frame = the culprit):\\n' + frames + '\\n');
      send('Debugger.resume');
      setTimeout(() => finish(), 250);
    }
  });

  // If pause never lands (rare), don't leak the socket.
  setTimeout(() => finish('stack capture timed out (no Debugger.paused within 4s)'), 4000);
}

setInterval(() => {
  const now = Date.now();
  if (now < START_AT) return;                 // boot grace period
  if (now - lastCaptureAt < COOLDOWN_MS) return; // don't re-fire on our own pause
  const gap = now - beat[0];
  if (gap > thresholdMs) {
    lastCaptureAt = now;
    captureStack(gap);
  }
}, 1000);
`;
