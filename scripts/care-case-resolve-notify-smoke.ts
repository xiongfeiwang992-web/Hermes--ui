import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const fixture = path.resolve("data", "care-case-resolve-notify.txt");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
fs.writeFileSync(fixture, "complaint evidence for resolve notify", "utf8");

const app = createApp(
  seedDatabase(path.resolve("data", "care-case-resolve-notify-smoke.db")).dbPath
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
const resolveMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "customer_care" &&
      (m.title === "客户投诉已解决" || m.title === "诉讼案件已解决")
  );

const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

const customer = app.call(
  "customer.create",
  { name: "解决通知客", phone: "13823001001", intent: "buy" },
  agentA
);
assert(customer.ok, "create customer");
const customerId = data<any>(customer).id;

function prepareInvestigating(title: string, phoneSuffix: string) {
  const c =
    phoneSuffix === "001"
      ? { ok: true, data: { id: customerId } }
      : app.call(
          "customer.create",
          {
            name: `解决客${phoneSuffix}`,
            phone: `13823001${phoneSuffix}`,
            intent: "buy",
          },
          agentA
        );
  assert(c.ok, `customer ${phoneSuffix}`);
  const created = app.call(
    "customerCare.cases.create",
    {
      case_type: "complaint",
      customer_id: data<any>(c).id,
      title,
      description: "客户反馈服务问题需要处理",
      severity: "medium",
    },
    agentA
  );
  assert(created.ok, `create case ${title}`);
  const id = data<any>(created).id;
  assert(
    app.call(
      "customerCare.cases.assign",
      {
        id,
        assignee_user_id: agentBId,
        due_date: "2026-09-30",
      },
      manager
    ).ok,
    `assign ${title}`
  );
  assert(
    app.call("customerCare.cases.investigate", { id }, agentB).ok,
    `investigate ${title}`
  );
  assert(
    app.call(
      "attachment.add",
      {
        parent_type: "customer_care_case",
        parent_id: id,
        category: "complaint_evidence",
        name: "凭证.txt",
        local_path: fixture,
      },
      agentB
    ).ok,
    `attach ${title}`
  );
  return id;
}

const caseId = prepareInvestigating("解决通知投诉", "001");
assert(
  !app.call(
    "customerCare.cases.resolve",
    { id: caseId, resolution: "" },
    agentB
  ).ok,
  "resolve requires resolution"
);

const beforeA = resolveMsgs(agentA).length;
const beforeB = resolveMsgs(agentB).length;
const beforeM = resolveMsgs(manager).length;
const resolved = app.call(
  "customerCare.cases.resolve",
  { id: caseId, resolution: "已沟通并补偿解释" },
  manager
);
assert(resolved.ok, "manager resolves complaint");
assert(data<any>(resolved).status === "resolved", "status resolved");
assert(resolveMsgs(agentA).length === beforeA + 1, "creator receives resolve message");
assert(resolveMsgs(agentB).length === beforeB + 1, "assignee receives resolve message");
assert(resolveMsgs(manager).length === beforeM, "resolver does not self-notify");
assert(
  resolveMsgs(agentA).some(
    (m) =>
      m.ref_id === caseId &&
      m.title === "客户投诉已解决" &&
      String(m.body).includes("解决通知投诉") &&
      String(m.body).includes("已沟通并补偿解释")
  ),
  "message has title and resolution"
);
assert(
  !app.call(
    "customerCare.cases.resolve",
    { id: caseId, resolution: "再次解决" },
    manager
  ).ok,
  "cannot resolve twice"
);

const selfCase = prepareInvestigating("自行解决投诉", "002");
const beforeSelf = resolveMsgs(agentB).length;
const beforeCreator = resolveMsgs(agentA).length;
assert(
  app.call(
    "customerCare.cases.resolve",
    { id: selfCase, resolution: "处理人自行办结" },
    agentB
  ).ok,
  "assignee resolves own case"
);
assert(resolveMsgs(agentB).length === beforeSelf, "assignee resolver skips self-notify");
assert(
  resolveMsgs(agentA).length === beforeCreator + 1,
  "creator still notified when assignee resolves"
);

const mutedCase = prepareInvestigating("静音解决投诉", "003");
assert(
  app.call("message.subscriptions.save", { channels: { care: false } }, agentA).ok,
  "mute care for creator"
);
assert(
  app.call("message.subscriptions.save", { channels: { care: false } }, agentB).ok,
  "mute care for assignee"
);
const beforeMuteA = resolveMsgs(agentA).length;
const beforeMuteB = resolveMsgs(agentB).length;
assert(
  app.call(
    "customerCare.cases.resolve",
    { id: mutedCase, resolution: "静音场景解决" },
    manager
  ).ok,
  "resolve while muted"
);
assert(resolveMsgs(agentA).length === beforeMuteA, "muted care suppresses creator message");
assert(resolveMsgs(agentB).length === beforeMuteB, "muted care suppresses assignee message");

// keep agentAId referenced
assert(Boolean(agentAId), "agentA id available");

console.log(`Care case resolve notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
