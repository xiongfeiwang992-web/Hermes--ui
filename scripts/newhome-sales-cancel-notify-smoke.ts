import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const fixture = path.resolve("data", "newhome-sales-cancel-notify-contract.txt");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(fixture, "newhome cancel notify contract", "utf8");

const app = createApp(
  seedDatabase(path.resolve("data", "newhome-sales-cancel-notify-smoke.db")).dbPath
);
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
const cancelMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "newhome_sales_report" && m.title === "新房销售报告已取消"
  );

const manager = login("manager");
const agent = login("agent_a");

const project = app.call(
  "newhome.projects.save",
  {
    name: "取消通知项目",
    address: "取消大道 1 号",
    property_type: "residential",
    protection_days: 15,
  },
  manager
);
assert(project.ok, "create project");
const projectId = data<any>(project).id;

function prepareSubmittedSale(phone: string, unitNo: string) {
  const customer = app.call(
    "customer.create",
    { name: `取消客${unitNo}`, phone, intent: "buy" },
    agent
  );
  assert(customer.ok, `create customer ${unitNo}`);
  const registration = app.call(
    "newhome.registrations.create",
    {
      project_id: projectId,
      customer_id: data<any>(customer).id,
      source: "门店到访",
    },
    agent
  );
  assert(registration.ok, `register ${unitNo}`);
  assert(
    app.call(
      "newhome.registrations.arrival",
      { id: data<any>(registration).id, arrival_note: "到场认购" },
      agent
    ).ok,
    `arrival ${unitNo}`
  );
  const sale = app.call(
    "newhome.sales.create",
    {
      registration_id: data<any>(registration).id,
      unit_no: unitNo,
      contract_price: 1500000,
      signed_at: "2026-08-05",
    },
    agent
  );
  assert(sale.ok, `create sale ${unitNo}`);
  const saleId = data<any>(sale).id;
  assert(
    app.call(
      "attachment.add",
      {
        parent_type: "newhome_sales_report",
        parent_id: saleId,
        category: "contract_scan",
        name: "合同.pdf",
        local_path: fixture,
      },
      agent
    ).ok,
    `attach ${unitNo}`
  );
  assert(
    app.call("newhome.sales.submit", { id: saleId }, agent).ok,
    `submit ${unitNo}`
  );
  return saleId;
}

const saleId = prepareSubmittedSale("13831001001", "1001");
const beforeAgent = cancelMsgs(agent).length;
const beforeManager = cancelMsgs(manager).length;

assert(
  !app.call("newhome.sales.cancel", { id: saleId, reason: "x" }, manager).ok,
  "cancel reason min length"
);
assert(
  !app.call(
    "newhome.sales.cancel",
    { id: saleId, reason: "经纪人不可取消待审" },
    agent
  ).ok,
  "agent cannot cancel submitted"
);

const cancelled = app.call(
  "newhome.sales.cancel",
  { id: saleId, reason: "客户退房不再申报" },
  manager
);
assert(cancelled.ok, "manager cancels submitted report");
assert(data<any>(cancelled).status === "cancelled", "status cancelled");
assert(
  data<any>(cancelled).cancel_reason === "客户退房不再申报",
  "cancel_reason returned"
);

const afterAgent = cancelMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives cancel message");
assert(afterAgent[0].ref_id === saleId, "message refs sales report");
assert(String(afterAgent[0].body).includes("1001"), "body has unit_no");
assert(String(afterAgent[0].body).includes("客户退房不再申报"), "body has reason");
assert(cancelMsgs(manager).length === beforeManager, "manager does not self-notify");

assert(
  !app.call(
    "newhome.sales.cancel",
    { id: saleId, reason: "再次取消" },
    manager
  ).ok,
  "cannot cancel twice"
);

const draftCustomer = app.call(
  "customer.create",
  { name: "自取消客", phone: "13831001002", intent: "buy" },
  agent
);
assert(draftCustomer.ok, "create draft customer");
const draftReg = app.call(
  "newhome.registrations.create",
  {
    project_id: projectId,
    customer_id: data<any>(draftCustomer).id,
  },
  agent
);
assert(draftReg.ok, "create draft registration");
assert(
  app.call(
    "newhome.registrations.arrival",
    { id: data<any>(draftReg).id, arrival_note: "到场" },
    agent
  ).ok,
  "arrival for draft"
);
const draftSale = app.call(
  "newhome.sales.create",
  {
    registration_id: data<any>(draftReg).id,
    unit_no: "1002",
    contract_price: 1600000,
    signed_at: "2026-08-06",
  },
  agent
);
assert(draftSale.ok, "create draft sale");
const beforeSelf = cancelMsgs(agent).length;
assert(
  app.call(
    "newhome.sales.cancel",
    { id: data<any>(draftSale).id, reason: "本人撤销草稿" },
    agent
  ).ok,
  "agent cancels own draft"
);
assert(cancelMsgs(agent).length === beforeSelf, "self cancel skips notify");

const mutedSale = prepareSubmittedSale("13831001003", "1003");
assert(
  app.call("message.subscriptions.save", { channels: { newhome: false } }, agent).ok,
  "mute newhome channel"
);
const beforeMute = cancelMsgs(agent).length;
assert(
  app.call(
    "newhome.sales.cancel",
    { id: mutedSale, reason: "静音取消测试" },
    manager
  ).ok,
  "cancel while muted"
);
assert(cancelMsgs(agent).length === beforeMute, "muted newhome suppresses cancel message");

console.log(`Newhome sales cancel notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
