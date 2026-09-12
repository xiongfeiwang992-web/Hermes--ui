import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "contract-template-notify-smoke.db")).dbPath
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
const templateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "合同模板已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "contract.template.save",
    {
      name: "店长不可建合同模板",
      deal_type: "sale",
      content: "买方卖方确认条款……",
    },
    manager
  ).ok,
  "manager cannot create contract template"
);

const beforeAdmin = templateMsgs(admin).length;
const beforeManager = templateMsgs(manager).length;
const beforeAgent = templateMsgs(agent).length;
const created = app.call(
  "contract.template.save",
  {
    name: "买卖合同通知模板",
    deal_type: "sale",
    content: "本合同由买卖双方确认签署。",
  },
  admin
);
assert(created.ok, "admin creates contract template");
const templateId = data<any>(created).id;
assert(templateMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  templateMsgs(manager).length === beforeManager + 1,
  "manager receives template message"
);
assert(templateMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  templateMsgs(manager).some(
    (m) =>
      m.ref_id === templateId &&
      m.ref_type === "contract_template" &&
      String(m.body).includes("买卖合同通知模板") &&
      String(m.body).includes("sale")
  ),
  "template message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = templateMsgs(manager).length;
assert(
  app.call(
    "contract.template.save",
    {
      name: "静音租赁合同模板",
      deal_type: "rent",
      content: "租赁合同条款正文。",
    },
    admin
  ).ok,
  "create while muted"
);
assert(templateMsgs(manager).length === beforeMute, "muted other suppresses message");

console.log(`Contract template notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
