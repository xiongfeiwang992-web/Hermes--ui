import { spawn } from "node:child_process";
import path from "node:path";

const children: ReturnType<typeof spawn>[] = [];

function run(command: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
  });
  children.push(child);
  return child;
}

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  run("npx", ["tsx", "scripts/seed.ts"]);
  await wait(1500);
  run("npx", ["tsx", "server/http.ts"], { PORT: "8787" });
  await wait(800);
  run("npx", ["vite", "--port", "5173"]);
  await wait(1200);
  run("npx", ["electron", "electron/main.dev.cjs"], {
    WEILAIJIA_RENDERER: "http://127.0.0.1:5173",
    WEILAIJIA_API: "http://127.0.0.1:8787",
  });
}

process.on("SIGINT", () => {
  for (const c of children) c.kill("SIGTERM");
  process.exit(0);
});

main();
