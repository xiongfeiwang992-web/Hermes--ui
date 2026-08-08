import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "contract-preview-smoke.db")).dbPath);
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
const agent = login("agent_a");
const other = login("agent_c");

const house = app.call(
  "house.create",
  {
    title: "合同预览房源",
    deal_type: "sale",
    community: "预览苑",
    price: 500,
    owner_name: "业主张三",
    owner_phone: "13770004401",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

const customer = app.call(
  "customer.create",
  { name: "客户李四", phone: "13770004402", intent: "buy" },
  agent
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

const deal = app.call(
  "deal.create",
  {
    house_id: houseId,
    customer_id: customerId,
    contract_price: 500,
    commission_owner: 10000,
    commission_customer: 5000,
    loan_amount: 300,
    loan_bank: "示例银行",
    remark: "本地预览备注",
  },
  agent
);
assert(deal.ok, "create deal");
const dealId = data<any>(deal).id;

const template = app.call(
  "contract.template.save",
  {
    name: "买卖预览模板",
    deal_type: "sale",
    content:
      "甲方{{owner}}与乙方{{customer}}就《{{house_title}}》成交，成交价{{contract_price}}，贷款{{loan_bank}}{{loan_amount}}万，经纪人{{agent}}。",
  },
  admin
);
assert(template.ok, "save template");
const templateId = data<any>(template).id;

const preview = app.call(
  "contract.preview",
  { deal_id: dealId, template_id: templateId },
  agent
);
assert(preview.ok, "preview with template id");
const body = data<any>(preview);
assert(body.legal_ca === false, "preview is non-CA");
assert(body.content.includes("业主张三"), "renders owner");
assert(body.content.includes("客户李四"), "renders customer");
assert(body.content.includes("合同预览房源"), "renders house title");
assert(body.content.includes("500"), "renders contract price");
assert(body.content.includes("示例银行"), "renders loan bank");
assert(body.content.includes("300"), "renders loan amount");
assert(body.content.includes("经纪人甲"), "renders agent name");
assert(body.placeholders_used.includes("owner"), "tracks owner placeholder");
assert(!body.content.includes("{{"), "no leftover braces for filled placeholders");

const auto = app.call("contract.preview", { deal_id: dealId }, agent);
assert(auto.ok, "preview auto-selects matching template");
assert(data<any>(auto).template_id === templateId, "auto uses latest sale template");

const inline = app.call(
  "contract.preview",
  {
    deal_id: dealId,
    content: "备注：{{remark}} / 缺失：{{unknown_field}}",
  },
  agent
);
assert(inline.ok, "preview inline content");
assert(data<any>(inline).content.includes("本地预览备注"), "inline remark filled");
assert(
  data<any>(inline).placeholders_missing.includes("unknown_field"),
  "reports missing placeholders"
);

assert(!app.call("contract.preview", { deal_id: dealId }, other).ok, "cross-store agent denied");
assert(!app.call("contract.preview", {}, agent).ok, "deal_id required");
assert(
  !app.call("contract.preview", { deal_id: dealId, template_id: "TPL_missing" }, agent).ok,
  "missing template rejected"
);

console.log(`Contract preview smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
