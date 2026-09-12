import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "office-ticket-issue-notify-smoke.db")).dbPath
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
const issuedMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_ticket" && m.title === "票据已发放"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const managerName = data<any>(app.call("auth.me", {}, manager)).display_name;

function prepareApproved(
  applicantToken: string,
  approverToken: string,
  title: string,
  quantity = 2
) {
  const created = app.call(
    "officeCollab.tickets.create",
    { ticket_type: "receipt", title, quantity },
    applicantToken
  );
  assert(created.ok, `create ${title}`);
  const id = data<any>(created).id;
  assert(
    app.call("officeCollab.tickets.approve", { id }, approverToken).ok,
    `approve ${title}`
  );
  return id;
}

assert(
  !app.call("officeCollab.tickets.issue", { id: "missing" }, manager).ok,
  "cannot issue missing ticket"
);

const title = "发放通知收据本";
const pending = app.call(
  "officeCollab.tickets.create",
  { ticket_type: "receipt", title, quantity: 4 },
  agent
);
assert(pending.ok, "create pending ticket");
const ticketId = data<any>(pending).id;
assert(
  !app.call("officeCollab.tickets.issue", { id: ticketId }, manager).ok,
  "cannot issue before approval"
);
assert(
  app.call("officeCollab.tickets.approve", { id: ticketId }, manager).ok,
  "approve ticket"
);

const beforeAgent = issuedMsgs(agent).length;
const beforeManager = issuedMsgs(manager).length;
const beforePeer = issuedMsgs(peer).length;
const issued = app.call("officeCollab.tickets.issue", { id: ticketId }, manager);
assert(issued.ok, "manager issues ticket");
assert(data<any>(issued).status === "issued", "status issued");
assert(issuedMsgs(agent).length === beforeAgent + 1, "applicant receives issued");
assert(issuedMsgs(manager).length === beforeManager, "issuer skips self");
assert(issuedMsgs(peer).length === beforePeer, "peer not notified");
assert(
  issuedMsgs(agent).some(
    (m) =>
      m.ref_id === ticketId &&
      m.ref_type === "office_ticket" &&
      String(m.body).includes(title) &&
      String(m.body).includes("4") &&
      String(m.body).includes(managerName)
  ),
  "issued message body"
);
assert(
  !app.call("officeCollab.tickets.issue", { id: ticketId }, manager).ok,
  "cannot issue twice"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, agent).ok,
  "mute office"
);
const muteId = prepareApproved(agent, manager, "静音发放票据", 1);
const beforeMute = issuedMsgs(agent).length;
assert(
  app.call("officeCollab.tickets.issue", { id: muteId }, manager).ok,
  "issue while muted"
);
assert(issuedMsgs(agent).length === beforeMute, "muted office suppresses issued");

const adminIssueId = prepareApproved(agent, manager, "管理员代发票据", 2);
const beforeAdminIssue = issuedMsgs(agent).length;
assert(
  app.call("officeCollab.tickets.issue", { id: adminIssueId }, admin).ok,
  "admin issues ticket"
);
assert(
  issuedMsgs(agent).length === beforeAdminIssue,
  "muted applicant still suppressed for admin issue"
);

console.log(
  `Office ticket issue notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
