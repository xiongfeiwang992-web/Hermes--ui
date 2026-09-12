import path from "node:path";
import { openDatabase, type Db } from "./db/database";
import { dispatch } from "./route/dispatch";
import * as org from "./domain/org";
import * as suite from "./domain/suite";
import * as system from "./domain/system";

export type AppContext = {
  db: Db;
  dbPath: string;
  call: (action: string, payload?: any, token?: string | null) => ReturnType<typeof dispatch>;
};

export function createApp(dbPath?: string): AppContext {
  const resolved =
    dbPath ||
    process.env.WEILAIJIA_DB ||
    path.resolve(process.cwd(), "data", "app.db");
  let db = openDatabase(resolved);
  return {
    get db() {
      return db;
    },
    dbPath: resolved,
    call: (action, payload = {}, token = null) => {
      if (action === "system.backup.restore") {
        const user = org.getSession(db, token);
        if (!user) return { ok: false, message: "未登录", code: 401 };
        if (!suite.featureAllowed(db, user, action)) {
          return { ok: false, message: "该功能已被管理员禁用", code: 403 };
        }
        try {
          return system.restoreBackup(db, user, payload, {
            dbPath: resolved,
            replaceDb: (next) => {
              db = next;
            },
          });
        } catch (err: any) {
          return { ok: false, message: err?.message || "恢复失败", code: 500 };
        }
      }
      return dispatch(db, action, payload, token);
    },
  };
}
