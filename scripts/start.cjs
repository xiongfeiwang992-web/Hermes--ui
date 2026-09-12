// 生产启动：API 服务 + Electron 桌面壳（需先 npm run build）
const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const children = [];

function run(cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const c of children) {
    try { c.kill(); } catch { /* ignore */ }
  }
  process.exit(0);
}

run(process.execPath, ["dist-server/server/http.js"], { PORT: process.env.PORT || "8787" });
setTimeout(() => {
  run("npx", ["electron", "."], {});
}, 1500);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
