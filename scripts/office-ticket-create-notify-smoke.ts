import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "office-ticket-create-notify-smoke.db")).dbPath
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
const pendingMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_ticket" && m.title === "票据申领待审批"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;
const managerName = data<any>(app.call("auth.me", {}, manager)).display_name;

assert(
  !app.call("officeCollab.tickets.create", { ticket_type: "receipt", title: "x" }, agent)
    .ok,
  "title too short rejected"
);

const title = "申领通知收据本";
const beforeAdmin = pendingMsgs(admin).length;
const beforeManager = pendingMsgs(manager).length;
const beforeAgent = pendingMsgs(agent).length;
const beforePeer = pendingMsgs(peer).length;
const created = app.call(
  "officeCollab.tickets.create",
  { ticket_type: "receipt", title, quantity: 3 },
  agent
);
assert(created.ok, "agent creates ticket");
const ticketId = data<any>(created).id;
assert(pendingMsgs(admin).length === beforeAdmin + 1, "admin receives pending ticket");
assert(
  pendingMsgs(manager).length === beforeManager + 1,
  "manager receives pending ticket"
);
assert(pendingMsgs(agent).length === beforeAgent, "applicant skips self");
assert(pendingMsgs(peer).length === beforePeer, "peer not notified");
assert(
  pendingMsgs(manager).some(
    (m) =>
      m.ref_id === ticketId &&
      m.ref_type === "office_ticket" &&
      String(m.body).includes(agentName) &&
      String(m.body).includes(title) &&
      String(m.body).includes("3")
  ),
  "pending ticket body"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, manager).ok,
  "mute office"
);
const beforeMute = pendingMsgs(manager).length;
assert(
  app.call(
    "officeCollab.tickets.create",
    { ticket_type: "invoice", title: "静音申领发票本", quantity: 1 },
    agent
  ).ok,
  "create while muted"
);
assert(pendingMsgs(manager).length === beforeMute, "muted office suppresses pending ticket");

const managerTicket = app.call(
  "officeCollab.tickets.create",
  { ticket_type: "other", title: "店长自申领票据", quantity: 2 },
  manager
);
assert(managerTicket.ok, "manager creates own ticket");
assert(pendingMsgs(manager).length === beforeMute, "manager skips self on own ticket");
assert(
  pendingMsgs(admin).some(
    (m) =>
      m.ref_id === data<any>(managerTicket).id && String(m.body).includes(managerName)
  ),
  "admin still notified when manager applies"
);

console.log(
  `Office ticket create notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
