// Frees the backend port BEFORE `npm run dev` starts.
//
// Why this exists: on Windows, stopping `npm run dev` (Ctrl+C / closing the terminal)
// does not reliably kill the deep ts-node child that actually binds the port. That
// orphan keeps holding the port, so the next start either can't bind it or ends up
// serving stale code — the "works on first run, gets stuck after a restart" problem.
// npm runs this automatically as the `predev` hook, so every start begins clean.
//
// Safe: it only ever kills the process LISTENING on THIS backend's own port
// (read from .env → PORT, else 5000). Other projects on other ports are untouched.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function resolvePort() {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
      const m = fs.readFileSync(envPath, 'utf8').match(/^\s*PORT\s*=\s*(\d+)/m);
      if (m) return m[1];
    }
  } catch { /* fall through to default */ }
  return process.env.PORT || '5000';
}

const port = resolvePort();

try {
  if (os.platform() === 'win32') {
    // netstat lists one line per socket; we want only LISTENING sockets on our port.
    let out = '';
    try {
      out = execSync(`netstat -ano -p tcp | findstr ":${port} "`, { encoding: 'utf8' });
    } catch {
      // findstr exits non-zero when there are no matches — that means the port is free.
    }
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/LISTENING\s+(\d+)$/);
      if (m) pids.add(m[1]);
    }
    if (pids.size === 0) {
      console.log(`[free-port] port ${port} already free`);
    } else {
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' }); // /T also kills the orphan's child tree
          console.log(`[free-port] freed port ${port} — killed stale PID ${pid}`);
        } catch (e) {
          console.log(`[free-port] could not kill PID ${pid}: ${e.message}`);
        }
      }
    }
  } else {
    // macOS / Linux
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' });
      const pids = out.split(/\s+/).filter(Boolean);
      if (pids.length === 0) console.log(`[free-port] port ${port} already free`);
      for (const pid of pids) {
        try { execSync(`kill -9 ${pid}`); console.log(`[free-port] freed port ${port} — killed stale PID ${pid}`); } catch { /* ignore */ }
      }
    } catch {
      console.log(`[free-port] port ${port} already free`);
    }
  }
} catch (e) {
  // Never block startup because cleanup hiccuped — worst case the server reports the
  // port is in use and you can run this script manually.
  console.log(`[free-port] skipped (${e.message})`);
}
