import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "modification-follow-smoke.db")).dbPath);
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

const agent = login("agent_a");

const house = app.call(
  "house.create",
  {
    title: "修改跟进房源",
    deal_type: "sale",
    community: "留痕苑",
    price: 200,
    owner_name: "原业主",
    owner_phone: "13810001000",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const noopHouse = app.call("house.update", { id: houseId, price: 200 }, agent);
assert(noopHouse.ok, "noop house update ok");
assert(
  !data<any[]>(app.call("follow.list", { target_id: houseId }, agent)).some(
    (row) => row.follow_kind === "modification"
  ),
  "noop house update skips modification follow"
);

const houseUpdate = app.call(
  "house.update",
  { id: houseId, price: 218, title: "修改跟进房源（已调价）" },
  agent
);
assert(houseUpdate.ok, "house update with changes");
const houseFollows = data<any[]>(app.call("follow.list", { target_id: houseId }, agent));
const houseMod = houseFollows.find((row) => row.follow_kind === "modification");
assert(!!houseMod, "house modification follow created");
assert(String(houseMod?.content || "").includes("价格"), "house follow mentions price");
assert(String(houseMod?.content || "").includes("200→218"), "house follow has price diff");
assert(String(houseMod?.content || "").includes("标题"), "house follow mentions title");
assert(houseMod?.method === "other", "house modification method is other");

const phoneUpdate = app.call(
  "house.update",
  { id: houseId, owner_phone: "13810009999" },
  agent
);
assert(phoneUpdate.ok, "house phone update");
const phoneFollow = data<any[]>(app.call("follow.list", { target_id: houseId }, agent)).find(
  (row) => row.follow_kind === "modification" && String(row.content).includes("业主电话")
);
assert(!!phoneFollow, "sensitive phone field creates modification follow");
assert(
  !String(phoneFollow?.content || "").includes("13810009999"),
  "raw phone not dumped in modification content"
);
assert(
  !String(phoneFollow?.content || "").includes("13810001000"),
  "old raw phone not dumped in modification content"
);

const customer = app.call(
  "customer.create",
  {
    name: "修改跟进客户",
    phone: "13920002000",
    intent: "buy",
    budget_min: 100,
    budget_max: 300,
    level: "B",
    source: "walk_in",
  },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

assert(
  app.call("customer.update", { id: customerId, budget_max: 300 }, agent).ok,
  "noop customer update ok"
);
assert(
  !data<any[]>(app.call("follow.list", { target_id: customerId }, agent)).some(
    (row) => row.follow_kind === "modification"
  ),
  "noop customer update skips modification follow"
);

const customerUpdate = app.call(
  "customer.update",
  { id: customerId, budget_max: 350, level: "A", phone: "13920008888" },
  agent
);
assert(customerUpdate.ok, "customer update with changes");
const customerMod = data<any[]>(
  app.call("follow.list", { target_id: customerId }, agent)
).find((row) => row.follow_kind === "modification");
assert(!!customerMod, "customer modification follow created");
assert(String(customerMod?.content || "").includes("预算上限"), "customer follow mentions budget");
assert(String(customerMod?.content || "").includes("300→350"), "customer follow has budget diff");
assert(String(customerMod?.content || "").includes("等级"), "customer follow mentions level");
assert(String(customerMod?.content || "").includes("电话已更新"), "customer phone masked in summary");
assert(
  !String(customerMod?.content || "").includes("13920008888"),
  "raw customer phone not dumped"
);

console.log(`modification-follow-smoke: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
