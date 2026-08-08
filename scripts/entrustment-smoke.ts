import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "entrustment-smoke.db")).dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const otherStore = login("agent_c");

const house = app.call(
  "house.create",
  {
    title: "委托测试房源",
    deal_type: "sale",
    community: "委托小区",
    price: 280,
    owner_name: "委托业主",
    owner_phone: "13740000001",
    status: "available",
  },
  agent
);
check(house.ok, "create entrustment house");
const houseId = data<any>(house).id;
const start = new Date();
const end = new Date(Date.now() + 60 * 86400000);
check(
  !app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "exclusive",
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    },
    peer
  ).ok,
  "non-owner agent cannot register entrustment"
);
check(
  !app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "exclusive",
      start_at: end.toISOString(),
      end_at: start.toISOString(),
    },
    agent
  ).ok,
  "reject invalid entrustment dates"
);
const registered = app.call(
  "entrustment.register",
  {
    house_id: houseId,
    entrust_type: "exclusive",
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    signed_at: start.toISOString(),
    remark: "纸质独家委托",
  },
  agent
);
check(registered.ok, "register active exclusive entrustment");
const entrustmentId = data<any>(registered).id;
check(
  !app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "general",
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    },
    agent
  ).ok,
  "prevent duplicate active entrustment"
);
const roleList = app.call("house.roles.list", { house_id: houseId }, manager);
check(
  roleList.ok &&
    data<any[]>(roleList).some(
      (role) => role.role_type === "entrustment" && Boolean(role.protected_until)
    ),
  "entrustment registers protected house role"
);
const fixture = path.resolve("data", "entrustment-fixture.txt");
fs.writeFileSync(fixture, "signed owner entrustment", "utf8");
check(
  app.call(
    "attachment.add",
    {
      parent_type: "house",
      parent_id: houseId,
      category: "entrustment",
      name: "独家委托扫描件.txt",
      local_path: fixture,
    },
    agent
  ).ok,
  "upload entrustment attachment"
);
const withAttachment = app.call("entrustment.list", { house_id: houseId }, manager);
check(
  withAttachment.ok &&
    data<any[]>(withAttachment)[0].attachment_name === "独家委托扫描件.txt",
  "attachment links to active entrustment"
);
check(
  !app.call(
    "entrustment.renew",
    { id: entrustmentId, end_at: new Date(Date.now() + 30 * 86400000).toISOString() },
    agent
  ).ok,
  "renewal must extend original end date"
);
const renewedEnd = new Date(Date.now() + 120 * 86400000).toISOString();
check(
  app.call(
    "entrustment.renew",
    { id: entrustmentId, end_at: renewedEnd },
    agent
  ).ok,
  "owner agent renews entrustment"
);
check(
  !app.call(
    "entrustment.terminate",
    { id: entrustmentId, reason: "" },
    manager
  ).ok,
  "termination requires reason"
);
check(
  app.call(
    "entrustment.terminate",
    { id: entrustmentId, reason: "业主书面撤销委托" },
    manager
  ).ok,
  "manager terminates entrustment"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "house",
      parent_id: houseId,
      category: "entrustment",
      name: "无生效委托附件.txt",
      local_path: fixture,
    },
    agent
  ).ok,
  "entrustment attachment requires active entrustment"
);
check(
  app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "general",
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    },
    agent
  ).ok,
  "register new entrustment after termination"
);
check(
  !app.call(
    "entrustment.register",
    {
      house_id: houseId,
      entrust_type: "rental_management",
      start_at: start.toISOString(),
      end_at: end.toISOString(),
    },
    admin
  ).ok,
  "rental management type rejected for sale house"
);
check(
  !app.call("entrustment.list", { house_id: houseId }, otherStore).ok,
  "entrustment preserves store isolation"
);
const messages = app.call("message.list", {}, agent);
check(
  messages.ok &&
    data<any[]>(messages).some((message) => message.kind === "entrustment_terminated"),
  "termination sends owner agent message"
);

console.log(`Entrustment smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
