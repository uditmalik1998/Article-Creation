// Attach to a frozen Node process, force its inspector open, and dump the JS stack
// where it's stuck. Usage: node capture-stack.js <pid>
const TARGET = Number(process.argv[2]);
if (!TARGET) { console.error('need pid'); process.exit(1); }

try {
  process._debugProcess(TARGET); // Windows: triggers the target to open inspector on 9229
} catch (e) {
  console.error('debugProcess failed:', e.message);
  process.exit(1);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await wait(1200); // give the target a moment to open its inspector

  let list;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9229/json/list');
      list = await res.json();
      if (list && list[0]?.webSocketDebuggerUrl) break;
    } catch { /* retry */ }
    await wait(500);
  }
  if (!list || !list[0]?.webSocketDebuggerUrl) {
    console.error('could not get inspector ws url'); process.exit(1);
  }

  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  let id = 0;
  const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params: params || {} }));

  const done = (code) => { try { ws.close(); } catch {} setTimeout(() => process.exit(code), 200); };

  ws.addEventListener('open', () => {
    send('Debugger.enable');
    send('Debugger.pause');
  });
  ws.addEventListener('error', (e) => { console.error('ws error', e?.message || e); done(1); });
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.method === 'Debugger.paused') {
      const frames = (m.params.callFrames || []).slice(0, 30).map((f, i) => {
        const loc = f.location || {};
        const url = (f.url || '?').replace(/^file:\/\/\//, '').replace(/^file:\/\//, '');
        return `#${String(i).padStart(2)}  ${f.functionName || '(anonymous)'}  ->  ${url}:${(loc.lineNumber || 0) + 1}`;
      });
      console.log('\n===== JS STACK OF FROZEN PROCESS (top = where it is stuck) =====\n');
      console.log(frames.join('\n'));
      console.log('\n================================================================\n');
      send('Debugger.resume');
      done(0);
    }
  });

  setTimeout(() => { console.error('timed out waiting for Debugger.paused (may be stuck in native code)'); done(1); }, 5000);
})();
