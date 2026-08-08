import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "deal-documents-smoke.db")).dbPath);
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
const otherStore = login("agent_c");

for (const [index, template] of [
  { category: "id_card", label: "身份证", required: true },
  { category: "property_cert", label: "不动产权证", required: true },
  { category: "contract", label: "买卖合同", required: true },
].entries()) {
  check(
    app.call(
      "deal.documents.template.save",
      { deal_type: "sale", sort_order: index + 1, ...template },
      admin
    ).ok,
    `save document template ${template.category}`
  );
}

for (const [index, template] of [
  { node_type: "contract", title: "合同网签", default_assignee_role: "agent" },
  { node_type: "tax", title: "税费办理", default_assignee_role: "store_manager" },
  { node_type: "transfer", title: "产权过户", default_assignee_role: "finance" },
].entries()) {
  check(
    app.call(
      "transfer.templates.save",
      { deal_type: "sale", sort_order: index + 1, ...template },
      admin
    ).ok,
    `save transfer template ${template.node_type}`
  );
}

check(
  app.call(
    "config.settings.save",
    {
      house_hold_limit: 20,
      manager_award_rate: 0,
      password_min_length: 8,
      deal_required_fields: [],
      deal_doc_required: true,
    },
    admin
  ).ok,
  "enable required deal documents"
);

const house = app.call(
  "house.create",
  {
    title: "资料清单房源",
    deal_type: "sale",
    community: "资料小区",
    price: 300,
    owner_name: "资料业主",
    owner_phone: "13770000001",
    status: "available",
  },
  agent
);
check(house.ok, "create document deal house");
const customer = app.call(
  "customer.create",
  { name: "资料客户", phone: "13870000001", intent: "buy" },
  agent
);
check(customer.ok, "create document deal customer");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const deal = app.call(
  "deal.create",
  {
    house_id: data<any>(house).id,
    customer_id: data<any>(customer).id,
    contract_price: 290,
    commission_owner: 12000,
    commission_customer: 8000,
    agent_ids: [agentId],
    split_ratios: { [agentId]: 100 },
  },
  agent
);
check(deal.ok, "create deal with initialized checklist");
const dealId = data<any>(deal).id;
const initial = app.call("deal.documents.list", { deal_id: dealId }, agent);
check(
  initial.ok &&
    data<any>(initial).required_count === 3 &&
    data<any>(initial).received_count === 0,
  "initialize required checklist from templates"
);
check(!app.call("deal.submit", { id: dealId }, agent).ok, "block submit while documents missing");

const fixture = path.resolve("data", "deal-document-fixture.txt");
fs.writeFileSync(fixture, "local acceptance fixture", "utf8");
for (const category of ["id_card", "property_cert", "contract"]) {
  check(
    app.call(
      "attachment.add",
      {
        parent_type: "deal",
        parent_id: dealId,
        category,
        name: `${category}.txt`,
        local_path: fixture,
      },
      agent
    ).ok,
    `attach and match ${category}`
  );
}
const completed = app.call("deal.documents.list", { deal_id: dealId }, manager);
check(
  completed.ok && data<any>(completed).complete && data<any>(completed).received_count === 3,
  "checklist completes after category attachments"
);
check(app.call("deal.submit", { id: dealId }, agent).ok, "submit after checklist complete");
check(app.call("deal.approve", { id: dealId }, manager).ok, "approve document-complete deal");
const nodes = app.call("transfer.list", { deal_id: dealId }, manager);
check(
  nodes.ok &&
    data<any[]>(nodes).length === 3 &&
    data<any[]>(nodes).every((node) => Boolean(node.assignee_user_id)),
  "approval seeds assigned transfer nodes"
);
check(
  data<any>(app.call("transfer.seed", { deal_id: dealId }, manager)).created === 0,
  "transfer template seed is idempotent"
);
check(
  !app.call("deal.documents.list", { deal_id: dealId }, otherStore).ok,
  "deal checklist preserves store isolation"
);

console.log(`Deal documents smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
