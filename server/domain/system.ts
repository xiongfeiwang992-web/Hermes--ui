import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/database";
import { openDatabase } from "../db/database";
import { writeAudit } from "./audit";
import { nowIso } from "../utils/id";
import type { ApiResult, SessionUser } from "../utils/types";

function backupsDirectory(): string {
  return path.resolve(process.cwd(), "data", "backups");
}

function assertSafeBackupFilename(filename: string): string | null {
  const trimmed = String(filename || "").trim();
  if (!trimmed || trimmed !== path.basename(trimmed) || !trimmed.endsWith(".db")) {
    return null;
  }
  if (trimmed.includes("..") || /[/\\]/.test(trimmed)) return null;
  return trimmed;
}

export function createBackup(db: Db, user: SessionUser): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const directory = backupsDirectory();
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
  const directory = backupsDirectory();
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

export function restoreBackup(
  db: Db,
  user: SessionUser,
  payload: { filename?: string },
  options: { dbPath: string; replaceDb: (next: Db) => void }
): ApiResult {
  if (user.role !== "admin") return { ok: false, message: "无权限", code: 403 };
  const filename = assertSafeBackupFilename(payload.filename || "");
  if (!filename) return { ok: false, message: "备份文件名无效" };
  const directory = backupsDirectory();
  const source = path.join(directory, filename);
  if (!fs.existsSync(source)) return { ok: false, message: "备份文件不存在" };

  fs.mkdirSync(directory, { recursive: true });
  const safetyName = `pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
  const safetyPath = path.join(directory, safetyName);
  const escapedSafety = safetyPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escapedSafety}'`);
  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // checkpoint best-effort
  }
  try {
    db.close();
  } catch {
    // ignore close errors and continue with file replace
  }

  for (const suffix of ["-wal", "-shm"]) {
    const side = `${options.dbPath}${suffix}`;
    if (fs.existsSync(side)) fs.unlinkSync(side);
  }
  fs.copyFileSync(source, options.dbPath);

  const next = openDatabase(options.dbPath);
  options.replaceDb(next);
  writeAudit(next, user, "system.restore", "database", filename, {
    safety_backup: safetyName,
  });
  return {
    ok: true,
    data: {
      filename,
      safety_backup: safetyName,
      restored_at: nowIso(),
    },
  };
}
