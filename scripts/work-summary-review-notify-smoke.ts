import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "work-summary-review-notify-smoke.db")).dbPath
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
const reviewMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "office_work_summary" && m.title === "工作总结已评阅"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let day = 1;
function createSubmitted(token: string, content: string) {
  const start = `2026-09-${String(day).padStart(2, "0")}`;
  const end = `2026-09-${String(day + 1).padStart(2, "0")}`;
  day += 3;
  const created = app.call(
    "officeCollab.summaries.save",
    {
      period_start: start,
      period_end: end,
      content,
    },
    token
  );
  assert(created.ok, `save ${content.slice(0, 8)}`);
  const id = data<any>(created).id;
  assert(
    app.call("officeCollab.summaries.submit", { id }, token).ok,
    `submit ${content.slice(0, 8)}`
  );
  return { id, start, end };
}

assert(
  !app.call(
    "officeCollab.summaries.review",
    { id: "missing", comment: "意见足够" },
    manager
  ).ok,
  "cannot review missing summary"
);

const first = createSubmitted(agent, "经纪人本周带看与跟进评阅通知");
assert(
  !app.call(
    "officeCollab.summaries.review",
    { id: first.id, comment: "x" },
    manager
  ).ok,
  "comment too short"
);
assert(
  !app.call(
    "officeCollab.summaries.review",
    { id: first.id, comment: "意见足够长" },
    peer
  ).ok,
  "peer agent cannot review"
);

const beforeAgent = reviewMsgs(agent).length;
const beforeManager = reviewMsgs(manager).length;
const reviewed = app.call(
  "officeCollab.summaries.review",
  { id: first.id, comment: "跟进扎实，下周继续" },
  manager
);
assert(reviewed.ok, "manager reviews agent summary");
assert(data<any>(reviewed).status === "reviewed", "status reviewed");
assert(reviewMsgs(agent).length === beforeAgent + 1, "author receives review message");
assert(reviewMsgs(manager).length === beforeManager, "reviewer skips self");
assert(
  reviewMsgs(agent).some(
    (m) =>
      m.ref_id === first.id &&
      m.ref_type === "office_work_summary" &&
      String(m.body).includes(first.start) &&
      String(m.body).includes(first.end) &&
      String(m.body).includes("跟进扎实，下周继续")
  ),
  "review message body"
);

const self = createSubmitted(manager, "店长自评阅工作总结内容足够");
const beforeSelf = reviewMsgs(manager).length;
assert(
  app.call(
    "officeCollab.summaries.review",
    { id: self.id, comment: "店长自评阅意见足够" },
    manager
  ).ok,
  "manager reviews own summary"
);
assert(reviewMsgs(manager).length === beforeSelf, "self-review skips notify");

assert(
  app.call("message.subscriptions.save", { channels: { office: false } }, agent).ok,
  "mute office"
);
const muted = createSubmitted(agent, "静音评阅工作总结内容足够");
const beforeMute = reviewMsgs(agent).length;
assert(
  app.call(
    "officeCollab.summaries.review",
    { id: muted.id, comment: "静音后评阅意见足够" },
    manager
  ).ok,
  "review while muted"
);
assert(reviewMsgs(agent).length === beforeMute, "muted office suppresses review message");

console.log(
  `Work summary review notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
