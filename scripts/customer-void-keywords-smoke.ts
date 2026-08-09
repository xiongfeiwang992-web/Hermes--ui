import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-void-keywords-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const assert = (value: unknown, name: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  assert(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};

const admin = login("admin");
const manager = login("manager");
const finance = login("finance");
const agent = login("agent_a");
const agentB = login("agent_b");

const defaults = app.call("customer.voidKeywords.settings", {}, admin);
assert(
  defaults.ok &&
    data<any>(defaults).hit_count === 0 &&
    Array.isArray(data<any>(defaults).keywords) &&
    data<any>(defaults).keywords.length === 0 &&
    data<any>(defaults).enabled === false,
  "void keywords disabled by default"
);

assert(
  !app.call("customer.voidKeywords.update", { keywords: ["勿扰"], hit_count: 2 }, manager).ok,
  "manager cannot update void keywords"
);
assert(
  !app.call("customer.voidKeywords.update", { keywords: ["勿扰"], hit_count: 2 }, finance).ok,
  "finance cannot update void keywords"
);
assert(
  !app.call(
    "customer.voidKeywords.update",
    { keywords: [], hit_count: 2 },
    admin
  ).ok,
  "reject enabled without keywords"
);

assert(
  app.call(
    "customer.voidKeywords.update",
    { keywords: "勿扰，骗子,无效客", hit_count: 2 },
    admin
  ).ok,
  "admin configures void keywords"
);
const configured = app.call("customer.voidKeywords.settings", {}, manager);
assert(
  configured.ok &&
    data<any>(configured).enabled &&
    data<any>(configured).hit_count === 2 &&
    data<any>(configured).keywords.includes("勿扰") &&
    data<any>(configured).keywords.includes("骗子") &&
    data<any>(configured).keywords.includes("无效客"),
  "settings readable by manager"
);

const own = app.call(
  "customer.create",
  { name: "手动作废客", phone: "13980001001", intent: "buy" },
  agent
);
assert(own.ok, "create own customer");
const ownId = data<any>(own).id;

assert(
  !app.call("customer.invalidate", { id: ownId, reason: "" }, agent).ok,
  "manual invalidate requires reason"
);

const manual = app.call("customer.invalidate", { id: ownId, reason: "客户明确不买" }, agent);
assert(manual.ok && data<any>(manual).status === "invalid", "agent can invalidate own");
assert(data<any>(manual).invalid_reason === "客户明确不买", "invalid reason persisted");

const listed = app.call("customer.list", { status: "invalid" }, agent);
assert(
  listed.ok && data<any[]>(listed).some((row) => row.id === ownId),
  "list filter status=invalid"
);

assert(
  !app.call("customer.invalidate", { id: ownId, reason: "再次作废" }, agent).ok,
  "cannot invalidate already invalid"
);

const other = app.call(
  "customer.create",
  { name: "他人客源", phone: "13980001002", intent: "rent" },
  agentB
);
assert(other.ok, "create other agent customer");
const otherId = data<any>(other).id;
assert(
  !app.call("customer.invalidate", { id: otherId, reason: "越权" }, agent).ok,
  "agent cannot invalidate others"
);
assert(
  app.call("customer.invalidate", { id: otherId, reason: "店长清理" }, manager).ok,
  "manager can invalidate store customer"
);

const autoTarget = app.call(
  "customer.create",
  { name: "关键字作废客", phone: "13980001003", intent: "buy" },
  agent
);
assert(autoTarget.ok, "create auto-void target");
const autoId = data<any>(autoTarget).id;

const follow1 = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: autoId,
    content: "客户说勿扰，先记下",
    method: "phone",
  },
  agent
);
assert(follow1.ok && !data<any>(follow1).auto_voided, "first keyword hit does not void");
const stillActive = app.call("customer.get", { id: autoId }, agent);
assert(stillActive.ok && data<any>(stillActive).status !== "invalid", "status still active");

const modFollow = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: autoId,
    content: "资料修改勿扰不应计数足够",
    method: "other",
    follow_kind: "modification",
  },
  agent
);
assert(modFollow.ok && !data<any>(modFollow).auto_voided, "modification follow ignored");

const follow2 = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: autoId,
    content: "再次确认是骗子勿联系",
    method: "wechat",
  },
  agent
);
assert(follow2.ok && data<any>(follow2).auto_voided === true, "second keyword hit auto voids");
const voided = app.call("customer.get", { id: autoId }, agent);
assert(
  voided.ok &&
    data<any>(voided).status === "invalid" &&
    String(data<any>(voided).invalid_reason || "").includes("关键字"),
  "auto void status and reason"
);

const audit = app.call("audit.list", { action: "customer.auto_void", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "customer.auto_void"),
  "auto void writes audit"
);
const manualAudit = app.call("audit.list", { action: "customer.invalidate", limit: 20 }, admin);
assert(
  manualAudit.ok &&
    (data<any[]>(manualAudit) || []).some((row) => row.action === "customer.invalidate"),
  "manual invalidate writes audit"
);

assert(
  app.call("customer.voidKeywords.update", { keywords: [], hit_count: 0 }, admin).ok,
  "admin can disable void keywords"
);

console.log(`Customer void keywords smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
