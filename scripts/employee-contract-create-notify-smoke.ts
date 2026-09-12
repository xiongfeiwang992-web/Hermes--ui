import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "employee-contract-create-notify-smoke.db")).dbPath
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
const createMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "employee_contract" && m.title === "员工合同已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

assert(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAId,
      contract_type: "labor",
      contract_no: "LAB-CREATE-NOTIFY-0",
      start_date: "2026-01-01",
      end_date: "2027-01-01",
    },
    manager
  ).ok,
  "manager cannot create contract"
);
assert(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAId,
      contract_type: "invalid",
      contract_no: "LAB-CREATE-NOTIFY-X",
      start_date: "2026-01-01",
      end_date: "2027-01-01",
    },
    admin
  ).ok,
  "invalid contract type rejected"
);

const beforeAgent = createMsgs(agentA).length;
const beforeAdmin = createMsgs(admin).length;
const created = app.call(
  "employee.contracts.create",
  {
    user_id: agentAId,
    contract_type: "labor",
    contract_no: "LAB-CREATE-NOTIFY-1",
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    probation_end_date: "2026-04-01",
    remark: "登记通知测试",
  },
  admin
);
assert(created.ok && data<any>(created).status === "draft", "admin creates contract");
const contractId = data<any>(created).id;
assert(createMsgs(agentA).length === beforeAgent + 1, "employee receives create message");
assert(createMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(
  createMsgs(agentA).some(
    (m) =>
      m.ref_id === contractId &&
      String(m.body).includes("LAB-CREATE-NOTIFY-1") &&
      String(m.body).includes("labor") &&
      String(m.body).includes("2026-01-01") &&
      String(m.body).includes("2027-12-31")
  ),
  "create message body"
);
assert(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAId,
      contract_type: "labor",
      contract_no: "LAB-CREATE-NOTIFY-1",
      start_date: "2026-02-01",
      end_date: "2027-02-01",
    },
    admin
  ).ok,
  "duplicate contract_no blocked"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agentB).ok,
  "mute hr"
);
const beforeMute = createMsgs(agentB).length;
assert(
  app.call(
    "employee.contracts.create",
    {
      user_id: agentBId,
      contract_type: "confidentiality",
      contract_no: "CNF-CREATE-NOTIFY-1",
      start_date: "2026-03-01",
      end_date: "2028-03-01",
    },
    admin
  ).ok,
  "create while muted"
);
assert(createMsgs(agentB).length === beforeMute, "muted hr suppresses create message");

console.log(
  `Employee contract create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
