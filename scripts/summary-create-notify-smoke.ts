import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "summary-create-notify-smoke.db")).dbPath
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
const draftMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_work_summary" && m.title === "工作总结草稿已创建"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const finance = login("finance");

assert(
  !app.call(
    "officeCollab.summaries.save",
    {
      period_start: "2026-09-01",
      period_end: "2026-09-07",
      content: "财务不可写总结内容",
    },
    finance
  ).ok,
  "finance cannot create summary"
);

const beforeAdmin = draftMsgs(admin).length;
const beforeManager = draftMsgs(manager).length;
const beforeAgent = draftMsgs(agent).length;
const created = app.call(
  "officeCollab.summaries.save",
  {
    period_start: "2026-09-01",
    period_end: "2026-09-07",
    content: "本周完成两单带看并跟进重点客",
  },
  agent
);
assert(created.ok, "agent creates summary draft");
const summaryId = data<any>(created).id;
assert(draftMsgs(admin).length === beforeAdmin + 1, "admin receives draft message");
assert(draftMsgs(manager).length === beforeManager + 1, "manager receives draft message");
assert(draftMsgs(agent).length === beforeAgent, "creator skips self");
assert(
  draftMsgs(manager).some(
    (m) =>
      m.ref_id === summaryId &&
      m.ref_type === "office_work_summary" &&
      String(m.body).includes("2026-09-01") &&
      String(m.body).includes("2026-09-07")
  ),
  "draft message body with period"
);

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, manager).ok,
  "mute office"
);
const beforeMute = draftMsgs(manager).length;
assert(
  app.call(
    "officeCollab.summaries.save",
    {
      period_start: "2026-09-08",
      period_end: "2026-09-14",
      content: "静音周期总结内容足够长",
    },
    agent
  ).ok,
  "create while muted"
);
assert(draftMsgs(manager).length === beforeMute, "muted office suppresses draft message");

console.log(`Summary create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
