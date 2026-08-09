import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "employee-contract-expire-notify-smoke.db")).dbPath
);
const signedPath = path.resolve("/tmp", "employee-contract-expire-notify.txt");
fs.writeFileSync(signedPath, "signed contract for expire notify");

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
const expireMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "employee_contract" && m.title === "员工合同已到期"
  );

const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentAId = data<any>(app.call("auth.me", {}, agentA)).id;

function activatePastEndContract(contractNo: string) {
  const created = app.call(
    "employee.contracts.create",
    {
      user_id: agentAId,
      contract_type: "labor",
      contract_no: contractNo,
      start_date: "2025-01-01",
      end_date: "2026-07-31",
      probation_end_date: "2025-03-31",
      remark: "到期通知测试",
    },
    admin
  );
  assert(created.ok, `create ${contractNo}`);
  const id = data<any>(created).id;
  assert(
    app.call(
      "employee.contracts.sign",
      { id, signed_at: "2025-01-02" },
      admin
    ).ok,
    `sign ${contractNo}`
  );
  assert(
    app.call(
      "attachment.add",
      {
        parent_type: "employee_contract",
        parent_id: id,
        category: "signed_contract",
        name: "已签合同.txt",
        local_path: signedPath,
      },
      admin
    ).ok,
    `attach ${contractNo}`
  );
  assert(
    app.call("employee.contracts.activate", { id }, admin).ok,
    `activate ${contractNo}`
  );
  return id;
}

assert(
  !app.call("employee.contracts.expire", {}, manager).ok,
  "manager cannot expire contracts"
);

const contractId = activatePastEndContract("LAB-EXPIRE-NOTIFY-1");
const beforeAgent = expireMsgs(agentA).length;
const beforeAdmin = expireMsgs(admin).length;
const expired = app.call("employee.contracts.expire", {}, admin);
assert(expired.ok, "admin refreshes expired contracts");
assert(data<any>(expired).expired >= 1, "at least one contract expired");

const afterAgent = expireMsgs(agentA);
assert(afterAgent.length === beforeAgent + 1, "employee receives expire message");
assert(
  afterAgent.some(
    (m) =>
      m.ref_id === contractId &&
      String(m.body).includes("LAB-EXPIRE-NOTIFY-1") &&
      String(m.body).includes("2026-07-31")
  ),
  "message refs contract with no and end date"
);
assert(expireMsgs(admin).length === beforeAdmin, "admin does not self-notify");

const second = app.call("employee.contracts.expire", {}, admin);
assert(second.ok && data<any>(second).expired === 0, "second expire is idempotent empty");
assert(
  expireMsgs(agentA).length === afterAgent.length,
  "idempotent expire does not re-notify"
);

const mutedId = activatePastEndContract("LAB-EXPIRE-NOTIFY-2");
assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agentA).ok,
  "mute hr channel"
);
const beforeMute = expireMsgs(agentA).length;
const mutedExpire = app.call("employee.contracts.expire", {}, admin);
assert(
  mutedExpire.ok && data<any>(mutedExpire).expired >= 1,
  "admin expires muted employee contract"
);
assert(
  data<any[]>(app.call("employee.contracts.list", { status: "expired" }, admin)).some(
    (item) => item.id === mutedId
  ),
  "muted contract reached expired status"
);
assert(expireMsgs(agentA).length === beforeMute, "muted hr suppresses expire message");

console.log(
  `Employee contract expire notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
