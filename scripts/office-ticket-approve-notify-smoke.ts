import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "office-ticket-approve-notify-smoke.db")).dbPath
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
const approvedMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_ticket" && m.title === "票据申领已批准"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const managerName = data<any>(app.call("auth.me", {}, manager)).display_name;

function createPending(token: string, title: string, quantity = 2) {
  const created = app.call(
    "officeCollab.tickets.create",
    { ticket_type: "receipt", title, quantity },
    token
  );
  assert(created.ok, `create ${title}`);
  return data<any>(created).id;
}

assert(
  !app.call("officeCollab.tickets.approve", { id: "missing" }, manager).ok,
  "cannot approve missing ticket"
);

const title = "审批通知收据本";
const ticketId = createPending(agent, title, 4);
assert(
  !app.call("officeCollab.tickets.approve", { id: ticketId }, agent).ok,
  "applicant cannot self-approve"
);
assert(
  !app.call("officeCollab.tickets.approve", { id: ticketId }, peer).ok,
  "peer cannot approve"
);

const beforeAgent = approvedMsgs(agent).length;
const beforeManager = approvedMsgs(manager).length;
const beforePeer = approvedMsgs(peer).length;
const approved = app.call("officeCollab.tickets.approve", { id: ticketId }, manager);
assert(approved.ok, "manager approves ticket");
assert(data<any>(approved).status === "approved", "status approved");
assert(approvedMsgs(agent).length === beforeAgent + 1, "applicant receives approved");
assert(approvedMsgs(manager).length === beforeManager, "reviewer skips self");
assert(approvedMsgs(peer).length === beforePeer, "peer not notified");
assert(
  approvedMsgs(agent).some(
    (m) =>
      m.ref_id === ticketId &&
      m.ref_type === "office_ticket" &&
      String(m.body).includes(title) &&
      String(m.body).includes("4") &&
      String(m.body).includes(managerName)
  ),
  "approved message body"
);
assert(
  !app.call("officeCollab.tickets.approve", { id: ticketId }, manager).ok,
  "cannot approve twice"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, agent).ok,
  "mute office"
);
const muteId = createPending(agent, "静音审批票据", 1);
const beforeMute = approvedMsgs(agent).length;
assert(
  app.call("officeCollab.tickets.approve", { id: muteId }, manager).ok,
  "approve while muted"
);
assert(approvedMsgs(agent).length === beforeMute, "muted office suppresses approved");

const adminApproveId = createPending(agent, "管理员代批票据", 2);
const beforeAdminApprove = approvedMsgs(agent).length;
assert(
  app.call("officeCollab.tickets.approve", { id: adminApproveId }, admin).ok,
  "admin approves ticket"
);
assert(
  approvedMsgs(agent).length === beforeAdminApprove,
  "muted applicant still suppressed for admin approve"
);

console.log(
  `Office ticket approve notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
