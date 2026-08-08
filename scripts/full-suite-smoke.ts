import path from "node:path";
import fs from "node:fs";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const dbPath = path.resolve("data", "full-suite-smoke.db");
seedDatabase(dbPath);
const app = createApp(dbPath);

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): void {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error("FAIL:", message);
  }
}

function dataOf<T = any>(result: any): T {
  return result.data as T;
}

function login(account: string, password = "123456"): string {
  const result = app.call("auth.login", { account, password });
  assert(result.ok, `${account} login`);
  return result.ok ? dataOf<any>(result).token : "";
}

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");

const detailedHouse = app.call(
  "house.create",
  {
    title: "商铺专项房源",
    deal_type: "sale",
    property_type: "shop",
    deal_mode: "exclusive",
    community: "中心商业街",
    area_size: 88,
    price: 380,
    owner_name: "商铺业主",
    owner_phone: "13622223333",
    status: "available",
  },
  agent
);
assert(detailedHouse.ok, "create property-type house");
assert(
  detailedHouse.ok &&
    dataOf<any>(detailedHouse).property_type === "shop" &&
    dataOf<any>(detailedHouse).deal_mode === "exclusive",
  "persist property type and deal mode"
);
const duplicateHouse = app.call(
  "house.create",
  {
    title: "疑似重复商铺",
    deal_type: "sale",
    property_type: "shop",
    community: "中心商业街",
    area_size: 90,
    price: 390,
    owner_name: "商铺业主",
    owner_phone: "13622223333",
    status: "available",
  },
  agent
);
assert(
  duplicateHouse.ok && Boolean(dataOf<any>(duplicateHouse).duplicate_hint),
  "house duplicate soft hint"
);

assert(
  app.call(
    "entrustment.register",
    {
      house_id: dataOf<any>(detailedHouse).id,
      entrust_type: "exclusive",
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    },
    agent
  ).ok,
  "register specialized house entrustment"
);
const attachmentFixture = path.resolve("data", "attachment-fixture.txt");
fs.writeFileSync(attachmentFixture, "contract fixture", "utf8");
const attachment = app.call(
  "attachment.add",
  {
    parent_type: "house",
    parent_id: dataOf<any>(detailedHouse).id,
    category: "entrustment",
    name: "委托书.txt",
    local_path: attachmentFixture,
  },
  agent
);
assert(attachment.ok, "add local business attachment");
const attachmentList = app.call(
  "attachment.list",
  {
    parent_type: "house",
    parent_id: dataOf<any>(detailedHouse).id,
  },
  agent
);
assert(
  attachmentList.ok && dataOf<any[]>(attachmentList).length === 1,
  "list local business attachment"
);

const cases = [
  { module: "finance", type: "expense", actor: finance, approver: finance },
  { module: "hr", type: "job_grade", actor: manager, approver: admin },
  { module: "office", type: "announcement", actor: agent, approver: manager },
  { module: "marketing", type: "lead", actor: manager, approver: manager },
  { module: "rental", type: "lease", actor: agent, approver: manager },
  { module: "customer_care", type: "complaint", actor: manager, approver: manager },
  { module: "performance", type: "points", actor: manager, approver: manager },
];

for (const item of cases) {
  const created = app.call(
    "suite.create",
    {
      module: item.module,
      record_type: item.type,
      title: `${item.module}-${item.type}`,
      amount: 100,
      data: { description: "全模块验收记录" },
    },
    item.actor
  );
  assert(created.ok, `create ${item.module}/${item.type}`);
  if (!created.ok) continue;
  const id = dataOf<any>(created).id;
  assert(
    app.call("suite.status", { id, status: "pending" }, item.actor).ok,
    `submit ${item.module}/${item.type}`
  );
  assert(
    app.call("suite.status", { id, status: "approved" }, item.approver).ok,
    `approve ${item.module}/${item.type}`
  );
  assert(
    app.call("suite.status", { id, status: "completed" }, item.approver).ok,
    `complete ${item.module}/${item.type}`
  );
}

const officeList = app.call("suite.list", { module: "office" }, manager);
assert(
  officeList.ok && dataOf<any[]>(officeList).some((item) => item.record_type === "announcement"),
  "list office records"
);

const blacklist = app.call(
  "blacklist.add",
  { kind: "phone", value: "13812345678", reason: "骚扰投诉" },
  manager
);
assert(blacklist.ok, "add masked blacklist");
const blacklists = app.call("blacklist.list", { kind: "phone" }, manager);
assert(
  blacklists.ok &&
    dataOf<any[]>(blacklists).some(
      (item) => item.display_value === "138****5678" && !JSON.stringify(item).includes("13812345678")
    ),
  "blacklist masks original value"
);
const filteredAudit = app.call(
  "audit.list",
  { action: "blacklist", target_type: "blacklist", limit: 500 },
  manager
);
assert(
  filteredAudit.ok &&
    dataOf<any[]>(filteredAudit).every(
      (item) => item.action.includes("blacklist") && item.target_type === "blacklist"
    ),
  "audit filters by action and target"
);

assert(
  app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: false },
    admin
  ).ok,
  "disable agent report feature"
);
const deniedReport = app.call("report.business", {}, agent);
assert(!deniedReport.ok && deniedReport.code === 403, "feature permission enforced");
assert(
  app.call(
    "permission.set",
    { role: "agent", feature: "report.*", allowed: true },
    admin
  ).ok,
  "restore agent report feature"
);

const integrations = app.call("integration.list", {}, admin);
assert(
  integrations.ok &&
    dataOf<any[]>(integrations).every((item) => !item.enabled),
  "external adapters disabled by default"
);
const unsafeIntegration = app.call(
  "integration.configure",
  {
    provider: "ca_esign",
    enabled: true,
    endpoint: "http://unsafe.example.com",
  },
  admin
);
assert(!unsafeIntegration.ok, "enabled adapter requires HTTPS");
assert(
  app.call(
    "integration.configure",
    {
      provider: "ca_esign",
      enabled: false,
      endpoint: "",
      credential_ref: "CA_SIGN_SECRET",
    },
    admin
  ).ok,
  "save disabled adapter configuration"
);

const backup = app.call("system.backup.create", {}, admin);
assert(backup.ok, "create SQLite backup");
assert(
  backup.ok && fs.existsSync(dataOf<any>(backup).path) && dataOf<any>(backup).size > 0,
  "backup file exists and is non-empty"
);
const backups = app.call("system.backup.list", {}, admin);
assert(backups.ok && dataOf<any[]>(backups).length >= 1, "list database backups");

const agentB = login("agent_b");
const shortPassword = app.call(
  "auth.changePassword",
  { current_password: "123456", new_password: "short" },
  agentB
);
assert(!shortPassword.ok, "reject short password");
const changedPassword = app.call(
  "auth.changePassword",
  { current_password: "123456", new_password: "new-pass-123" },
  agentB
);
assert(changedPassword.ok, "change password and invalidate sessions");
assert(!app.call("auth.me", {}, agentB).ok, "old session invalidated after password change");
login("agent_b", "new-pass-123");

console.log(`Full suite smoke result: passed=${passed} failed=${failed}`);
if (failed > 0) process.exit(1);
