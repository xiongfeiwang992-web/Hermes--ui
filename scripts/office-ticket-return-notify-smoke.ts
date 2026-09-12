import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "office-ticket-return-notify-smoke.db")).dbPath
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
const returnMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_ticket" && m.title === "票据已回收"
  );

function prepareIssuedTicket(agentToken: string, managerToken: string, title: string) {
  const ticket = app.call(
    "officeCollab.tickets.create",
    { ticket_type: "receipt", title, quantity: 1 },
    agentToken
  );
  assert(ticket.ok, `create ticket ${title}`);
  const id = data<any>(ticket).id;
  assert(
    app.call("officeCollab.tickets.approve", { id }, managerToken).ok,
    `approve ${title}`
  );
  assert(
    app.call("officeCollab.tickets.issue", { id }, managerToken).ok,
    `issue ${title}`
  );
  return id;
}

const agent = login("agent_a");
const manager = login("manager");
const admin = login("admin");

const ticketId = prepareIssuedTicket(agent, manager, "回收通知收据本");
const beforeManager = returnMsgs(manager).length;
const beforeAdmin = returnMsgs(admin).length;
const beforeAgent = returnMsgs(agent).length;

assert(
  app.call("officeCollab.tickets.return", { id: ticketId }, agent).ok,
  "applicant returns issued ticket"
);

assert(
  returnMsgs(manager).length === beforeManager + 1,
  "manager receives return message on applicant return"
);
assert(
  returnMsgs(admin).length === beforeAdmin + 1,
  "admin receives return message on applicant return"
);
const mgrMsg = returnMsgs(manager)[0];
assert(mgrMsg.ref_id === ticketId, "message refs ticket");
assert(String(mgrMsg.body).includes("回收通知收据本"), "body has title");
assert(String(mgrMsg.body).includes("经纪人甲"), "body has returner name");
assert(returnMsgs(agent).length === beforeAgent, "applicant does not self-notify");

assert(
  !app.call("officeCollab.tickets.return", { id: ticketId }, agent).ok,
  "cannot return twice"
);

const ticket2 = prepareIssuedTicket(agent, manager, "店长代回收票据");
const beforeAgent2 = returnMsgs(agent).length;
const beforeManager2 = returnMsgs(manager).length;
assert(
  app.call("officeCollab.tickets.return", { id: ticket2 }, manager).ok,
  "manager returns on behalf of applicant"
);
assert(
  returnMsgs(agent).length === beforeAgent2 + 1,
  "applicant receives return message when manager returns"
);
assert(
  String(returnMsgs(agent)[0].body).includes("一号店长"),
  "body has manager as returner"
);
assert(
  returnMsgs(manager).length === beforeManager2,
  "manager returner does not self-notify"
);

const ticket3 = prepareIssuedTicket(agent, manager, "静音回收票据");
assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, manager).ok,
  "mute office channel for manager"
);
assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, admin).ok,
  "mute office channel for admin"
);
const beforeMuteMgr = returnMsgs(manager).length;
const beforeMuteAdmin = returnMsgs(admin).length;
assert(
  app.call("officeCollab.tickets.return", { id: ticket3 }, agent).ok,
  "return while managers muted"
);
assert(returnMsgs(manager).length === beforeMuteMgr, "muted office suppresses manager message");
assert(returnMsgs(admin).length === beforeMuteAdmin, "muted office suppresses admin message");

console.log(`Office ticket return notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
