import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "employee-contract-sign-notify-smoke.db")).dbPath
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
const signMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "employee_contract" && m.title === "员工合同已登记签署"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;
const agentBId = data<any>(app.call("auth.me", {}, agentB)).id;

function createDraft(userId: string, contractNo: string) {
  const created = app.call(
    "employee.contracts.create",
    {
      user_id: userId,
      contract_type: "labor",
      contract_no: contractNo,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
    },
    admin
  );
  assert(created.ok, `create ${contractNo}`);
  return data<any>(created).id;
}

const contractId = createDraft(agentAId, "LAB-SIGN-NOTIFY-1");
assert(
  !app.call(
    "employee.contracts.sign",
    { id: contractId, signed_at: "2026-01-02" },
    manager
  ).ok,
  "manager cannot sign"
);
assert(
  !app.call(
    "employee.contracts.sign",
    { id: contractId, signed_at: "2099-01-01" },
    admin
  ).ok,
  "future signed_at rejected"
);

const beforeAgent = signMsgs(agentA).length;
const beforeAdmin = signMsgs(admin).length;
assert(
  app.call(
    "employee.contracts.sign",
    { id: contractId, signed_at: "2026-01-02" },
    admin
  ).ok,
  "admin signs contract"
);
assert(signMsgs(agentA).length === beforeAgent + 1, "employee receives sign message");
assert(signMsgs(admin).length === beforeAdmin, "admin actor does not self-notify");
assert(
  signMsgs(agentA).some(
    (m) =>
      m.ref_id === contractId &&
      String(m.body).includes("LAB-SIGN-NOTIFY-1") &&
      String(m.body).includes("2026-01-02")
  ),
  "sign message body"
);
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agentB).ok,
  "mute hr"
);
const mutedId = createDraft(agentBId, "LAB-SIGN-NOTIFY-2");
const beforeMute = signMsgs(agentB).length;
assert(
  app.call(
    "employee.contracts.sign",
    { id: mutedId, signed_at: "2026-01-05" },
    admin
  ).ok,
  "sign while muted"
);
assert(signMsgs(agentB).length === beforeMute, "muted hr suppresses sign message");

console.log(
  `Employee contract sign notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
