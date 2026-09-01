import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "circle-create-notify-smoke.db")).dbPath
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
const circleMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "同事圈有新动态"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");
const agentName = data<any>(app.call("auth.me", {}, agent)).display_name;

assert(
  !app.call("officeCollab.circle.create", { content: "x" }, agent).ok,
  "content too short rejected"
);

const beforeManager = circleMsgs(manager).length;
const beforeAdmin = circleMsgs(admin).length;
const beforeAgent = circleMsgs(agent).length;
const beforePeer = circleMsgs(peer).length;
const post = app.call(
  "officeCollab.circle.create",
  { content: "本周带看反馈汇总，欢迎补充" },
  agent
);
assert(post.ok, "agent creates circle post");
const postId = data<any>(post).id;
assert(circleMsgs(manager).length === beforeManager + 1, "manager receives post message");
assert(circleMsgs(admin).length === beforeAdmin + 1, "admin receives post message");
assert(circleMsgs(agent).length === beforeAgent, "author does not self-notify");
assert(circleMsgs(peer).length === beforePeer, "peer agent does not receive");
assert(
  circleMsgs(manager).some(
    (m) =>
      m.ref_id === postId &&
      String(m.body).includes(agentName) &&
      String(m.body).includes("本周带看反馈汇总")
  ),
  "post message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = circleMsgs(manager).length;
assert(
  app.call(
    "officeCollab.circle.create",
    { content: "静音后的第二条动态内容" },
    peer
  ).ok,
  "peer posts while manager muted"
);
assert(circleMsgs(manager).length === beforeMute, "muted other suppresses circle message");
assert(
  circleMsgs(admin).some((m) => String(m.body).includes("静音后的第二条")),
  "admin still notified while manager muted"
);

const beforeSelf = circleMsgs(manager).length;
assert(
  app.call(
    "officeCollab.circle.create",
    { content: "店长自己发的动态不通知自己" },
    manager
  ).ok,
  "manager posts own"
);
assert(circleMsgs(manager).length === beforeSelf, "manager self-post skips notify");

console.log(`Circle create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
