import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./createApp";

const port = Number(process.env.PORT || 8787);
const app = createApp();
const rendererRoot = path.resolve("dist-renderer");
const maxBodyBytes = 1024 * 1024;

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "请求处理失败" }));
  });
});

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  const address = server.address() as { port: number };
  const hosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
  const origins = new Set([...hosts.map((host) => `http://${host}`), "http://127.0.0.1:5173", "http://localhost:5173"]);
  const origin = req.headers.origin;
  if (!hosts.includes(req.headers.host || "") || (origin && !origins.has(origin))) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, message: "不允许的请求来源" }));
    return;
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/call") {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > maxBodyBytes) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, message: "请求内容过大" }));
        return;
      }
      chunks.push(chunk as Buffer);
    }
    let body: any = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "JSON 无效" }));
      return;
    }
    if (!body || Array.isArray(body) || typeof body !== "object" || typeof body.action !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message: "请求操作无效" }));
      return;
    }
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : body.token || null;
    const result = app.call(body.action, body.payload || {}, token);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    try {
      const pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
      const allowed = pathname === "/" || pathname === "/index.html" || pathname.startsWith("/assets/");
      const file = path.resolve(rendererRoot, pathname === "/" ? "index.html" : `.${pathname}`);
      const relative = path.relative(rendererRoot, file);
      if (allowed && !pathname.includes("\\") && !relative.startsWith("..") && !path.isAbsolute(relative) && fs.statSync(file).isFile()) {
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
        res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
        return;
      }
    } catch { /* Missing or invalid paths are not exposed outside the renderer directory. */ }
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, message: "Not Found" }));
}

server.listen(port, "127.0.0.1", () => {
  const address = server.address() as { port: number };
  console.log(`[Open Real Estate Brokerage System] http://127.0.0.1:${address.port}`);
});
