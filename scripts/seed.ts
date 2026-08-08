import fs from "node:fs";
import path from "node:path";
import { createApp } from "../server/createApp";
import { hashPassword } from "../server/utils/password";
import { nextId, nowIso } from "../server/utils/id";

export function seedDatabase(dbPath?: string) {
  const resolved = dbPath || process.env.WEILAIJIA_DB || path.resolve("data", "app.db");
  if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
  for (const suffix of ["-wal", "-shm"]) {
    const p = resolved + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const app = createApp(resolved);
  const db = app.db;
  const now = nowIso();

  const companyId = nextId("CO");
  const storeA = nextId("ST");
  const storeB = nextId("ST");

  db.prepare(
    `INSERT INTO companies(id, name, status, created_at) VALUES (?, ?, 'active', ?)`
  ).run(companyId, "示例房产", now);
  db.prepare(
    `INSERT INTO stores(id, company_id, name, address, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
  ).run(storeA, companyId, "一号店", "示例路 1 号", now);
  db.prepare(
    `INSERT INTO stores(id, company_id, name, address, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`
  ).run(storeB, companyId, "二号店", "示例路 2 号", now);
  db.prepare(
    `INSERT INTO settings(company_id, agent_pool_rate, created_at, updated_at) VALUES (?, 0.5, ?, ?)`
  ).run(companyId, now, now);

  function addUser(
    account: string,
    name: string,
    role: string,
    storeId: string,
    password = "123456"
  ) {
    const id = nextId("USR");
    db.prepare(
      `INSERT INTO users(id, company_id, store_id, account, display_name, password_hash, role, phone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
    ).run(id, companyId, storeId, account, name, hashPassword(password), role, null, now);
    return id;
  }

  const adminId = addUser("admin", "系统管理员", "admin", storeA);
  addUser("manager", "一号店长", "store_manager", storeA);
  addUser("agent_a", "经纪人甲", "agent", storeA);
  addUser("agent_b", "经纪人乙", "agent", storeA);
  addUser("finance", "财务小王", "finance", storeA);
  addUser("agent_c", "二号店经纪人", "agent", storeB);

  const followMethods = [
    ["phone", "电话", 1],
    ["wechat", "微信", 2],
    ["visit", "拜访", 3],
    ["other", "其他", 4],
  ] as const;
  for (const [value, label, sortOrder] of followMethods) {
    db.prepare(
      `INSERT INTO data_dictionaries(
        id, company_id, dict_type, value, label, sort_order, status, created_by, created_at, updated_at
      ) VALUES (?, ?, 'follow_method', ?, ?, ?, 'active', ?, ?, ?)`
    ).run(nextId("DIC"), companyId, value, label, sortOrder, adminId, now, now);
  }

  return { dbPath: resolved, companyId, storeA, storeB };
}

if (require.main === module) {
  const result = seedDatabase();
  console.log("Seed completed:", result.dbPath);
  console.log(
    "Demo accounts (password: 123456): admin / manager / agent_a / agent_b / finance / agent_c"
  );
}
