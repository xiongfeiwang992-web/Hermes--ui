import path from "node:path";
import { openDatabase, type Db } from "./db/database";
import { dispatch } from "./route/dispatch";

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
  const db = openDatabase(resolved);
  return {
    db,
    dbPath: resolved,
    call: (action, payload = {}, token = null) => dispatch(db, action, payload, token),
  };
}
