import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "circle-hide-notify-smoke.db")).dbPath
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
const hideMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "同事圈动态已隐藏"
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

function createPost(token: string, content: string) {
  const created = app.call("officeCollab.circle.create", { content }, token);
  assert(created.ok, `create post ${content.slice(0, 8)}`);
  return data<any>(created).id;
}

assert(
  !app.call(
    "officeCollab.circle.hide",
    { id: "missing", reason: "短" },
    manager
  ).ok,
  "hide reason min length"
);

const postId = createPost(agent, "今天带看反馈很好值得分享");
const beforeAgent = hideMsgs(agent).length;
const beforeManager = hideMsgs(manager).length;
const beforePeer = hideMsgs(peer).length;
const hidden = app.call(
  "officeCollab.circle.hide",
  { id: postId, reason: "内容不合规" },
  manager
);
assert(hidden.ok, "manager hides agent post");
assert(data<any>(hidden).status === "hidden", "status hidden");
const afterAgent = hideMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "author receives hide message");
assert(afterAgent[0].ref_id === postId, "message refs post");
assert(String(afterAgent[0].body).includes("今天带看反馈"), "body has content snippet");
assert(String(afterAgent[0].body).includes("内容不合规"), "body has reason");
assert(hideMsgs(manager).length === beforeManager, "hider does not self-notify");
assert(hideMsgs(peer).length === beforePeer, "peer not notified");
assert(
  !app.call(
    "officeCollab.circle.hide",
    { id: postId, reason: "再次隐藏" },
    manager
  ).ok,
  "cannot hide twice"
);

const selfPost = createPost(manager, "店长自己发的同事圈内容");
const beforeSelf = hideMsgs(manager).length;
assert(
  app.call(
    "officeCollab.circle.hide",
    { id: selfPost, reason: "自隐藏测试" },
    manager
  ).ok,
  "manager hides own post"
);
assert(hideMsgs(manager).length === beforeSelf, "self-hide skips notify");

const mutedPost = createPost(agent, "静音隐藏动态内容");
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = hideMsgs(agent).length;
assert(
  app.call(
    "officeCollab.circle.hide",
    { id: mutedPost, reason: "静音场景隐藏" },
    manager
  ).ok,
  "hide while muted"
);
assert(hideMsgs(agent).length === beforeMute, "muted other suppresses hide message");

console.log(`Circle hide notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
