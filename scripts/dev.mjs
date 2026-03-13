import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const withServer = rawArgs.includes('--server');
const viteArgs = rawArgs.filter(arg => arg !== '--server');

const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const proxyEntry = path.join(rootDir, 'server', 'proxy.mjs');

const children = [];
let isShuttingDown = false;

function runNode(scriptPath, args = [], env = process.env) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 100);
}

let proxy = null;
if (withServer) {
  proxy = runNode(proxyEntry, [], {
    ...process.env,
    SHADOWGRID_SERVER_MODE: '1',
    SHADOWGRID_SERVER_HEAVY: process.env.SHADOWGRID_SERVER_HEAVY ?? '1',
  });
}

// Keep client mode aligned with launcher mode:
// - npm run dev -- --host          => normal client mode (no proxy required)
// - npm run dev -- --host --server => heavy client mode (expects local proxy)
const viteEnv = {
  ...process.env,
  VITE_SERVER_HEAVY_MODE: withServer ? 'true' : 'false',
};

const vite = runNode(viteBin, viteArgs, viteEnv);

if (proxy) {
  proxy.on('exit', (code, signal) => {
    if (isShuttingDown) return;
    const exitCode = Number.isInteger(code) ? code : 1;
    if (exitCode !== 0) {
      console.error(`\n[dev] Proxy exited early (code=${exitCode}${signal ? `, signal=${signal}` : ''}).`);
      console.error('[dev] Heavy mode requires the proxy. On a new server, run npm install and then retry.');
      shutdown(exitCode);
      return;
    }
    console.error('\n[dev] Proxy exited, stopping dev server because --server mode requires it.');
    shutdown(0);
  });
}

vite.on('exit', (code) => {
  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
