import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "view-export-smoke.db")).dbPath);
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
const finance = login("finance");

const house = app.call(
  "house.create",
  {
    title: "带看导出房源",
    deal_type: "sale",
    community: "导出苑",
    price: 220,
    owner_name: "业主",
    owner_phone: "13770003301",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  { name: "带看导出客户", phone: "13770003302", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const users = data<any[]>(app.call("org.users.list", {}, admin));
const peer = users.find((row) => row.account === "agent_b");
assert(!!peer?.id, "resolve accompany peer");

const view = app.call(
  "view.create",
  {
    customer_id: customerId,
    house_id: houseId,
    view_at: new Date().toISOString(),
    accompany_ids: peer ? [peer.id] : [],
    content: "客户重点看南向户型",
  },
  agent
);
assert(view.ok, "create view with accompany");
const viewId = data<any>(view).id;

assert(
  app.call(
    "view.complete",
    { id: viewId, feedback: "interested", content: "有意向" },
    agent
  ).ok,
  "complete view"
);

const listCsv = app.call("report.viewsCsv", { status: "done", feedback: "interested" }, agent);
assert(listCsv.ok, "export views csv");
const listContent = data<any>(listCsv).content as string;
assert(listContent.startsWith("\uFEFF"), "views csv has utf8 bom");
assert(listContent.includes("带看导出客户"), "csv includes customer name");
assert(listContent.includes("带看导出房源"), "csv includes house title");
assert(listContent.includes("经纪人甲"), "csv includes agent display name");
if (peer) assert(listContent.includes(peer.display_name), "csv includes accompany name");
assert(listContent.includes(viewId), "csv includes view id");

const emptyFilter = app.call("report.viewsCsv", { status: "planned" }, agent);
assert(emptyFilter.ok && data<any>(emptyFilter).rows === 0, "filtered csv can be empty");

const slip = app.call("report.viewSlip", { id: viewId }, agent);
assert(slip.ok, "export view slip");
const slipContent = data<any>(slip).content as string;
assert(data<any>(slip).filename.includes(viewId), "slip filename uses view id");
assert(slipContent.includes("带看单") || slipContent.includes("带看编号"), "slip has slip fields");
assert(slipContent.includes("带看导出客户"), "slip includes customer name");
assert(slipContent.includes("带看导出房源"), "slip includes house title");
assert(slipContent.includes("客户重点看南向户型") || slipContent.includes("有意向"), "slip includes notes");

assert(app.call("report.viewSlip", { id: viewId }, manager).ok, "manager can export slip");
assert(app.call("report.viewsCsv", {}, manager).ok, "manager can export list");
assert(!app.call("report.viewSlip", { id: viewId }, finance).ok, "finance cannot export slip");
assert(!app.call("report.viewsCsv", {}, finance).ok, "finance cannot export list");
assert(!app.call("report.viewSlip", { id: "VW_missing" }, agent).ok, "missing view rejected");
assert(!app.call("report.viewSlip", {}, agent).ok, "slip requires id");

console.log(`View export smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
