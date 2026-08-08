import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";
import { todayDate } from "../server/utils/id";

const app = createApp(seedDatabase(path.resolve("data", "employee-contract-smoke.db")).dbPath);
const signedPath = path.resolve("/tmp", "signed-employee-contract.txt");
const renewalPath = path.resolve("/tmp", "employee-contract-renewal.txt");
fs.writeFileSync(signedPath, "local signed employee contract");
fs.writeFileSync(renewalPath, "local employee contract renewal");
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
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));
const agentCUser = data<any>(app.call("auth.me", {}, agentC));

check(
  data<any>(app.call("employee.contracts.options", {}, agentA)).users.length === 1,
  "employee contract options restricted to self"
);
check(
  data<any>(app.call("employee.contracts.options", {}, manager)).users.every(
    (employee: any) => employee.store_id === agentAUser.store_id
  ),
  "manager contract options restricted to own store"
);
check(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAUser.id,
      contract_type: "labor",
      contract_no: "LAB-001",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    },
    manager
  ).ok,
  "only admin can create employee contract"
);
check(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAUser.id,
      contract_type: "invalid",
      contract_no: "INVALID",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    },
    admin
  ).ok,
  "contract type validated"
);
check(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAUser.id,
      contract_type: "labor",
      contract_no: "INVALID-DATE",
      start_date: "2026-12-31",
      end_date: "2026-01-01",
    },
    admin
  ).ok,
  "contract date range validated"
);
check(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAUser.id,
      contract_type: "labor",
      contract_no: "INVALID-PROBATION",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      probation_end_date: "2027-01-01",
    },
    admin
  ).ok,
  "probation date must be within contract"
);
const contract = app.call(
  "employee.contracts.create",
  {
    user_id: agentAUser.id,
    contract_type: "labor",
    contract_no: "LAB-001",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    probation_end_date: "2026-03-31",
    remark: "正式劳动合同",
  },
  admin
);
check(contract.ok && data<any>(contract).status === "draft", "admin creates contract draft");
const contractId = data<any>(contract).id;
check(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentAUser.id,
      contract_type: "labor",
      contract_no: "LAB-OVERLAP",
      start_date: "2026-06-01",
      end_date: "2027-05-31",
    },
    admin
  ).ok,
  "overlapping same-type contract rejected"
);
check(
  !app.call(
    "employee.contracts.create",
    {
      user_id: agentBUser.id,
      contract_type: "labor",
      contract_no: "LAB-001",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
    },
    admin
  ).ok,
  "contract number unique company-wide"
);
check(
  !app.call(
    "employee.contracts.sign",
    { id: contractId, signed_at: "2099-01-01" },
    admin
  ).ok,
  "future signature date rejected"
);
check(
  app.call(
    "employee.contracts.sign",
    { id: contractId, signed_at: todayDate() },
    admin
  ).ok,
  "admin registers signature date"
);
check(
  !app.call("employee.contracts.activate", { id: contractId }, admin).ok,
  "signed attachment required before activation"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: contractId,
      category: "signed_contract",
      name: "越权合同.txt",
      local_path: signedPath,
    },
    agentB
  ).ok,
  "other employee cannot upload contract attachment"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: contractId,
      category: "invalid",
      name: "错误分类.txt",
      local_path: signedPath,
    },
    agentA
  ).ok,
  "employee contract attachment category enforced"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: contractId,
      category: "signed_contract",
      name: "劳动合同扫描件.txt",
      local_path: signedPath,
    },
    agentA
  ).ok,
  "employee uploads own signed contract"
);
check(
  app.call("employee.contracts.activate", { id: contractId }, admin).ok,
  "admin activates signed contract"
);
check(
  data<any[]>(app.call("employee.contracts.list", {}, agentA)).length === 1,
  "employee sees own contract"
);
check(
  data<any[]>(app.call("employee.contracts.list", {}, agentB)).length === 0,
  "employee cannot see coworker contract"
);
check(
  data<any[]>(app.call("employee.contracts.list", {}, manager)).some(
    (item) => item.id === contractId
  ),
  "manager sees own-store employee contract"
);
check(
  data<any[]>(app.call("employee.contracts.list", {}, finance)).length === 0,
  "finance sees only own employee contracts"
);
check(
  data<any[]>(app.call("employee.contracts.events", { id: contractId }, agentA)).some(
    (event) => event.event_type === "signed"
  ),
  "employee reads own contract event history"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.kind === "employee_contract"
  ),
  "employee receives activation message"
);
check(
  !app.call(
    "employee.contracts.renew",
    { id: contractId, end_date: "2027-12-31" },
    admin
  ).ok,
  "renewal attachment required"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: contractId,
      category: "contract_renewal",
      name: "续签协议.txt",
      local_path: renewalPath,
    },
    agentA
  ).ok,
  "employee uploads own renewal agreement"
);
check(
  !app.call(
    "employee.contracts.renew",
    { id: contractId, end_date: "2026-11-30" },
    admin
  ).ok,
  "renewal end date must extend contract"
);
check(
  app.call(
    "employee.contracts.renew",
    { id: contractId, end_date: "2027-12-31" },
    admin
  ).ok,
  "admin renews contract with new attachment"
);
check(
  !app.call(
    "employee.contracts.renew",
    { id: contractId, end_date: "2028-12-31" },
    admin
  ).ok,
  "each renewal requires a new attachment"
);
check(
  !app.call(
    "employee.contracts.terminate",
    { id: contractId, reason: "" },
    admin
  ).ok,
  "contract termination requires reason"
);
check(
  !app.call(
    "employee.contracts.terminate",
    { id: contractId, reason: "无权限" },
    manager
  ).ok,
  "manager cannot terminate employee contract"
);
check(
  app.call(
    "employee.contracts.terminate",
    { id: contractId, reason: "双方协商解除" },
    admin
  ).ok,
  "admin terminates active contract"
);
check(
  !app.call(
    "employee.contracts.terminate",
    { id: contractId, reason: "重复终止" },
    admin
  ).ok,
  "terminated contract cannot terminate twice"
);
check(
  !app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: contractId,
      category: "contract_renewal",
      name: "终止后附件.txt",
      local_path: renewalPath,
    },
    agentA
  ).ok,
  "terminated contract rejects new attachments"
);

const expiredContract = app.call(
  "employee.contracts.create",
  {
    user_id: agentBUser.id,
    contract_type: "confidentiality",
    contract_no: "CONF-001",
    start_date: "2025-01-01",
    end_date: "2026-07-31",
    signed_at: "2025-01-01",
  },
  admin
);
check(expiredContract.ok, "create past-end contract for expiration");
const expiredId = data<any>(expiredContract).id;
check(
  app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: expiredId,
      category: "signed_contract",
      name: "保密协议.txt",
      local_path: signedPath,
    },
    admin
  ).ok && app.call("employee.contracts.activate", { id: expiredId }, admin).ok,
  "upload and activate past-end contract"
);
const expired = app.call("employee.contracts.expire", {}, admin);
check(
  expired.ok && data<any>(expired).expired === 1,
  "admin refreshes expired contracts"
);
check(
  data<any[]>(app.call("employee.contracts.list", { status: "expired" }, manager)).some(
    (item) => item.id === expiredId
  ),
  "expired contract visible in store scope"
);
check(
  app.call(
    "attachment.add",
    {
      parent_type: "employee_contract",
      parent_id: expiredId,
      category: "contract_renewal",
      name: "到期续签协议.txt",
      local_path: renewalPath,
    },
    agentB
  ).ok,
  "employee can upload renewal for expired contract"
);
check(
  app.call(
    "employee.contracts.renew",
    { id: expiredId, end_date: "2027-07-31" },
    admin
  ).ok,
  "expired contract can renew back to active"
);
const crossStore = app.call(
  "employee.contracts.create",
  {
    user_id: agentCUser.id,
    contract_type: "noncompete",
    contract_no: "NC-001",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
  },
  admin
);
check(crossStore.ok, "admin creates cross-store contract");
check(
  !data<any[]>(app.call("employee.contracts.list", {}, manager)).some(
    (item) => item.id === data<any>(crossStore).id
  ),
  "manager cannot see another store contract"
);
check(
  !app.call("employee.contracts.events", { id: contractId }, agentC).ok,
  "other store employee cannot read contract events"
);
check(
  !app.call("employee.contracts.expire", {}, manager).ok,
  "only admin can refresh contract expiration"
);

console.log(`Employee contract smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
