import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "customer-hold-limit-smoke.db")).dbPath);
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
const agent = login("agent_a");
const peer = login("agent_b");

const settings = data<any>(app.call("config.settings.get", {}, admin));
assert(Number(settings.customer_hold_limit) === 20, "default customer hold limit is 20");

assert(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: settings.house_hold_limit,
      customer_hold_limit: 2,
      manager_award_rate: settings.manager_award_rate,
      password_min_length: settings.password_min_length,
      house_role_protection_days: settings.house_role_protection_days,
      deal_doc_required: !!settings.deal_doc_required,
      force_follow_before_phone: !!settings.force_follow_before_phone,
      non_holder_view_remind: !!settings.non_holder_view_remind,
      deal_required_fields: settings.deal_required_fields || [],
    },
    admin
  ).ok,
  "admin sets customer hold limit to 2"
);
assert(
  data<any>(app.call("config.settings.get", {}, admin)).customer_hold_limit === 2,
  "customer hold limit saved"
);

assert(
  !app.call(
    "config.settings.save",
    {
      house_hold_limit: settings.house_hold_limit,
      customer_hold_limit: 0,
      manager_award_rate: settings.manager_award_rate,
      password_min_length: settings.password_min_length,
      house_role_protection_days: settings.house_role_protection_days,
      deal_doc_required: !!settings.deal_doc_required,
      force_follow_before_phone: !!settings.force_follow_before_phone,
      non_holder_view_remind: !!settings.non_holder_view_remind,
      deal_required_fields: settings.deal_required_fields || [],
    },
    admin
  ).ok,
  "reject customer hold limit below 1"
);

const c1 = app.call(
  "customer.create",
  { name: "暂缓客一", phone: "13610001001", intent: "buy" },
  agent
);
const c2 = app.call(
  "customer.create",
  { name: "暂缓客二", phone: "13610001002", intent: "buy" },
  agent
);
const c3 = app.call(
  "customer.create",
  { name: "暂缓客三", phone: "13610001003", intent: "rent" },
  agent
);
assert(c1.ok && c2.ok && c3.ok, "create three private customers");
const id1 = data<any>(c1).id;
const id2 = data<any>(c2).id;
const id3 = data<any>(c3).id;

const peerCus = app.call(
  "customer.create",
  { name: "乙的客", phone: "13610001004", intent: "buy" },
  peer
);
assert(peerCus.ok, "peer creates customer");
assert(
  !app.call("customer.suspend", { id: data<any>(peerCus).id }, agent).ok,
  "agent cannot suspend peer customer"
);

assert(app.call("customer.suspend", { id: id1, reason: "暂缓一" }, agent).ok, "suspend first");
assert(data<any>(app.call("customer.get", { id: id1 }, agent)).status === "suspended", "status suspended");
assert(app.call("customer.suspend", { id: id2 }, agent).ok, "suspend second");

const over = app.call("customer.suspend", { id: id3 }, agent);
assert(!over.ok && String(over.message).includes("上限"), "third suspend blocked by limit");

assert(
  data<any[]>(app.call("customer.list", { status: "suspended" }, agent)).filter((row) =>
    [id1, id2].includes(row.id)
  ).length === 2,
  "list filter suspended"
);

assert(app.call("customer.resume", { id: id1 }, agent).ok, "resume first");
assert(
  data<any>(app.call("customer.get", { id: id1 }, agent)).status === "following",
  "resumed to following"
);
assert(app.call("customer.suspend", { id: id3 }, agent).ok, "suspend third after resume frees slot");

assert(
  !app.call("customer.suspend", { id: id2 }, agent).ok,
  "already suspended cannot suspend again"
);

const publicCus = app.call(
  "customer.create",
  { name: "将转公", phone: "13610001005", intent: "buy" },
  agent
);
assert(publicCus.ok, "create for public");
const publicId = data<any>(publicCus).id;
assert(app.call("customer.toPublic", { id: publicId, reason: "转公" }, agent).ok, "to public");
assert(
  !app.call("customer.suspend", { id: publicId }, agent).ok,
  "public customer cannot suspend"
);

assert(
  app.call("customer.resume", { id: id2 }, manager).ok,
  "manager can resume store customer"
);

const audit = app.call("audit.list", { action: "customer.suspend", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "customer.suspend"),
  "suspend writes audit"
);

console.log(`Customer hold limit smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
