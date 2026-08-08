import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/database";
import { writeAudit } from "./audit";
import { nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

export function createBackup(db: Db, user: SessionUser): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const directory = path.resolve(process.cwd(), "data", "backups");
  fs.mkdirSync(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `weilaijia-${stamp}.db`;
  const target = path.join(directory, filename);
  const escaped = target.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  const size = fs.statSync(target).size;
  writeAudit(db, user, "system.backup", "database", filename, { size });
  return {
    ok: true,
    data: {
      filename,
      path: target,
      size,
      created_at: nowIso(),
    },
  };
}

export function listBackups(user: SessionUser): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const directory = path.resolve(process.cwd(), "data", "backups");
  if (!fs.existsSync(directory)) return { ok: true, data: [] };
  const rows = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".db"))
    .map((name) => {
      const fullPath = path.join(directory, name);
      const stat = fs.statSync(fullPath);
      return {
        filename: name,
        path: fullPath,
        size: stat.size,
        created_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { ok: true, data: rows };
}
