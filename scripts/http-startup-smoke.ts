import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { seedDatabase } from "./seed";

async function main() {
  fs.mkdirSync("data", { recursive: true });
  const directory = fs.mkdtempSync(path.resolve("data", "http-smoke-"));
  const dbPath = seedDatabase(path.join(directory, "app.db")).dbPath;
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const child = spawn(process.execPath, [require.resolve("tsx/cli"), "server/http.ts"], {
    env: { ...process.env, PORT: String(port), WEILAIJIA_DB: dbPath }, stdio: "pipe",
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk; });
  child.stderr.on("data", (chunk) => { logs += chunk; });
  const exited = once(child, "exit");
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try { ready = (await fetch(base + "/health")).ok; } catch { /* wait for binding */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `HTTP startup: ${logs}`);
    for (const origin of ["https://untrusted.example", "null"]) {
      const blocked = await fetch(base + "/api/call", {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth.login", payload: { account: "admin", password: "123456" } }),
      });
      assert.equal(blocked.status, 403, "untrusted websites cannot call the local API");
    }
    const response = await fetch(base);
    assert.equal(response.status, 200, "built UI is served from the API origin");
    const html = await response.text();
    assert.ok(html.includes("Open Real Estate Brokerage System"), "product title is served");
    const script = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(script, "built JavaScript entry exists");
    const asset = await fetch(new URL(script, base));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") || "", /javascript/);
    for (const target of ["/data/app.db", "/package.json", "/..%5cpackage.json"]) {
      assert.equal((await fetch(base + target)).status, 404, `no source/data disclosure: ${target}`);
    }
    const login = await fetch(base + "/api/call", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ action: "auth.login", payload: { account: "agent_a", password: "123456" } }),
    });
    assert.ok((await login.json() as any).ok, "same-origin API login");
    assert.equal(login.headers.get("Access-Control-Allow-Origin"), base);
    assert.equal((await fetch(base + "/api/call", { method: "POST", body: "{" })).status, 400);
    assert.equal((await fetch(base + "/api/call", { method: "POST", body: "x".repeat(1024 * 1024 + 1) })).status, 413);
    console.log("HTTP startup: UI, assets, login, path isolation and request limits pass.");
  } finally {
    if (child.exitCode === null) child.kill();
    await exited;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
