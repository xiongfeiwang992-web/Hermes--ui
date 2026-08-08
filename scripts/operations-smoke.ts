import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "operations-smoke.db")).dbPath);
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

const agent = login("agent_a");
const peer = login("agent_b");
const manager = login("manager");
const finance = login("finance");
const otherStore = login("agent_c");

const house = app.call(
  "house.create",
  {
    title: "运营导出房源",
    deal_type: "sale",
    community: "运营小区",
    price: 180,
    area_size: 90,
    owner_name: "运营业主",
    owner_phone: "13790000001",
    status: "available",
  },
  agent
);
check(house.ok, "create export house");
const houseId = data<any>(house).id;
check(
  app.call(
    "house.lock",
    { id: houseId, locked: true, reason: "导出前锁定保护" },
    agent
  ).ok,
  "lock export house"
);
check(
  app.call("house.update", { id: houseId, title: "锁定后更新", is_locked: false }, agent).ok &&
    data<any>(app.call("house.get", { id: houseId }, agent)).is_locked === 1,
  "generic update cannot bypass house lock operation"
);

const customer = app.call(
  "customer.create",
  {
    name: "运营客户",
    phone: "13890000001",
    intent: "buy",
    budget_max: 200,
  },
  agent
);
check(customer.ok, "create export customer");
const customerId = data<any>(customer).id;
const follow = app.call(
  "follow.create",
  {
    target_type: "house",
    target_id: houseId,
    content: "业主同意下调挂牌价格",
    method: "call",
    follow_kind: "price_change",
  },
  agent
);
check(follow.ok, "create price-change follow");
const view = app.call(
  "view.create",
  {
    house_id: houseId,
    customer_id: customerId,
    view_at: new Date().toISOString(),
    content: "客户现场看房",
  },
  agent
);
check(view.ok, "create operational view");
check(
  app.call(
    "view.complete",
    { id: data<any>(view).id, feedback: "interested", content: "客户有意向" },
    agent
  ).ok,
  "complete effective view"
);

for (const action of [
  "report.housesCsv",
  "report.customersCsv",
  "report.followsCsv",
  "report.viewsCsv",
]) {
  const result = app.call(action, {}, agent);
  check(result.ok && data<any>(result).content.startsWith("\uFEFF"), `${action} utf8 csv`);
}
const peerHouseCsv = app.call("report.housesCsv", {}, peer);
check(
  peerHouseCsv.ok && !data<any>(peerHouseCsv).content.includes("13790000001"),
  "house export preserves phone masking"
);
const crossStoreCsv = app.call("report.housesCsv", {}, otherStore);
check(
  crossStoreCsv.ok && !data<any>(crossStoreCsv).content.includes(houseId),
  "house export preserves store isolation"
);
check(!app.call("report.customersCsv", {}, finance).ok, "finance cannot export customers");

const stats = app.call("report.activityStats", { month: new Date().toISOString().slice(0, 7) }, manager);
check(
  stats.ok &&
    data<any>(stats).follow_count === 2 &&
    data<any>(stats).view_count === 1 &&
    data<any>(stats).effective_view_count === 1,
  "activity statistics aggregate follow and effective view"
);
check(
  stats.ok && data<any>(stats).rankings.some((row: any) => row.price_change_count === 1),
  "activity rankings include price change follow"
);

console.log(`Operations smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
