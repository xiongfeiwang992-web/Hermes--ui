import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "work-summary-submit-notify-smoke.db")).dbPath
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
const submitMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_work_summary" && m.title === "工作总结待评阅"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

let seq = 0;
function createDraft(token: string, content: string) {
  seq += 1;
  const created = app.call(
    "officeCollab.summaries.save",
    {
      period_start: "2026-08-01",
      period_end: "2026-08-07",
      content,
    },
    token
  );
  assert(created.ok, `create draft ${seq}`);
  return data<any>(created).id;
}

assert(
  !app.call("officeCollab.summaries.submit", { id: "missing" }, agent).ok,
  "cannot submit missing summary"
);

const draftId = createDraft(agent, "本周带看与跟进情况汇总");
const beforeManager = submitMsgs(manager).length;
const beforeAdmin = submitMsgs(admin).length;
const beforeAgent = submitMsgs(agent).length;
const beforePeer = submitMsgs(peer).length;
const submitted = app.call("officeCollab.summaries.submit", { id: draftId }, agent);
assert(submitted.ok, "agent submits summary");
assert(data<any>(submitted).status === "submitted", "status submitted");

const afterManager = submitMsgs(manager);
assert(afterManager.length === beforeManager + 1, "store manager receives submit message");
assert(afterManager[0].ref_id === draftId, "manager message refs summary");
assert(String(afterManager[0].body).includes(agentName), "body has author name");
assert(String(afterManager[0].body).includes("2026-08-01"), "body has period start");
assert(String(afterManager[0].body).includes("2026-08-07"), "body has period end");

assert(submitMsgs(admin).length === beforeAdmin + 1, "admin receives submit message");
assert(
  submitMsgs(admin).some((m) => m.ref_id === draftId),
  "admin message refs summary"
);
assert(submitMsgs(agent).length === beforeAgent, "submitter does not self-notify");
assert(submitMsgs(peer).length === beforePeer, "peer agent not notified");

assert(
  !app.call("officeCollab.summaries.submit", { id: draftId }, agent).ok,
  "cannot submit twice"
);

const managerDraft = createDraft(manager, "店长本周门店经营总结内容");
const beforeManagerSelf = submitMsgs(manager).length;
const beforeAdmin2 = submitMsgs(admin).length;
assert(
  app.call("officeCollab.summaries.submit", { id: managerDraft }, manager).ok,
  "manager submits own summary"
);
assert(
  submitMsgs(manager).length === beforeManagerSelf,
  "manager submitter skips self-notify"
);
assert(
  submitMsgs(admin).length === beforeAdmin2 + 1,
  "admin still notified when manager submits"
);

const mutedDraft = createDraft(agent, "静音场景工作总结内容");
assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, manager).ok,
  "mute office channel for manager"
);
assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, admin).ok,
  "mute office channel for admin"
);
const beforeMuteManager = submitMsgs(manager).length;
const beforeMuteAdmin = submitMsgs(admin).length;
assert(
  app.call("officeCollab.summaries.submit", { id: mutedDraft }, agent).ok,
  "submit while reviewers muted"
);
assert(
  submitMsgs(manager).length === beforeMuteManager,
  "muted office suppresses manager message"
);
assert(
  submitMsgs(admin).length === beforeMuteAdmin,
  "muted office suppresses admin message"
);

console.log(
  `Work summary submit notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
