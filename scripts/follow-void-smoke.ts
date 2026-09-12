import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "follow-void-smoke.db")).dbPath);
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

const customer = app.call(
  "customer.create",
  { name: "作废跟进客", phone: "13680004101", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const follow = app.call(
  "follow.create",
  {
    target_type: "customer",
    target_id: customerId,
    method: "phone",
    content: "客户表示本周方便看房，先记一笔",
    next_follow_at: new Date().toISOString(),
  },
  agent
);
assert(follow.ok, "create follow");
const followId = data<any>(follow).id;

assert(
  !app.call("follow.void", { id: followId, reason: "越权" }, manager).ok,
  "manager cannot void"
);
assert(
  !app.call("follow.void", { id: followId, reason: "越权" }, agent).ok,
  "agent cannot void"
);
assert(
  !app.call("follow.void", { id: followId, reason: "越权" }, finance).ok,
  "finance cannot void"
);
assert(
  !app.call("follow.void", { id: followId, reason: "" }, admin).ok,
  "void requires reason"
);

const voided = app.call("follow.void", { id: followId, reason: "内容录错需作废" }, admin);
assert(voided.ok && Number(data<any>(voided).voided) === 1, "admin voids follow");
assert(data<any>(voided).void_reason === "内容录错需作废", "void reason persisted");
assert(data<any>(voided).voided_by && data<any>(voided).voided_at, "void metadata persisted");

const listed = data<any[]>(app.call("follow.list", {}, admin));
assert(
  !listed.some((row) => row.id === followId),
  "voided follow hidden from list"
);

assert(
  !app.call("follow.void", { id: followId, reason: "再次作废" }, admin).ok,
  "cannot void again"
);

const house = app.call(
  "house.create",
  {
    title: "作废跟进房",
    deal_type: "sale",
    community: "作废苑",
    price: 180,
    owner_name: "业主",
    owner_phone: "13680004102",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseFollow = app.call(
  "follow.create",
  {
    target_type: "house",
    target_id: data<any>(house).id,
    method: "visit",
    content: "实地核实钥匙与水电情况并拍照",
  },
  agent
);
assert(houseFollow.ok, "create house follow");
assert(
  app.call(
    "follow.void",
    { id: data<any>(houseFollow).id, reason: "重复录入" },
    admin
  ).ok,
  "admin voids house follow"
);

const audit = app.call("audit.list", { action: "follow.void", limit: 20 }, admin);
assert(
  audit.ok && (data<any[]>(audit) || []).some((row) => row.action === "follow.void"),
  "void writes audit"
);

const messages = app.call("message.list", {}, agent);
assert(
  messages.ok &&
    (data<any[]>(messages) || []).some(
      (row) => row.kind === "follow_void" && String(row.body || "").includes(followId)
    ),
  "agent notified of void"
);

const due = data<any[]>(app.call("follow.list", { due: "today" }, agent));
assert(
  !due.some((row) => row.id === followId),
  "voided follow excluded from due list"
);

console.log(`Follow void smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
