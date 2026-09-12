import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "blacklist-create-notify-smoke.db")).dbPath
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
const blMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "黑名单已登记"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

const beforeAdmin = blMsgs(admin).length;
const beforeManager = blMsgs(manager).length;
const beforeAgent = blMsgs(agent).length;
const added = app.call(
  "blacklist.add",
  { kind: "phone", value: "13800138001", reason: "恶意骚扰客户" },
  manager
);
assert(added.ok, "manager adds blacklist");
const blId = data<any>(added).id;
assert(blMsgs(admin).length === beforeAdmin + 1, "admin receives blacklist message");
assert(blMsgs(manager).length === beforeManager, "creator does not self-notify");
assert(blMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  blMsgs(admin).some(
    (m) =>
      m.ref_id === blId &&
      String(m.body).includes("phone") &&
      String(m.body).includes("恶意骚扰客户") &&
      String(m.body).includes("****")
  ),
  "blacklist message body masked"
);

const beforeSelfAdmin = blMsgs(admin).length;
const beforeSelfMgr = blMsgs(manager).length;
const adminAdd = app.call(
  "blacklist.add",
  { kind: "id_card", value: "110101199001011234", reason: "欺诈风险客户" },
  admin
);
assert(adminAdd.ok, "admin adds blacklist");
assert(blMsgs(admin).length === beforeSelfAdmin, "admin actor skips self");
assert(blMsgs(manager).length === beforeSelfMgr + 1, "manager receives admin add");

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = blMsgs(manager).length;
const beforeMuteAdmin = blMsgs(admin).length;
assert(
  app.call(
    "blacklist.add",
    { kind: "lead", value: "13900139001", reason: "静音黑名单测试" },
    admin
  ).ok,
  "add while muted"
);
assert(blMsgs(manager).length === beforeMute, "muted other suppresses message");
assert(blMsgs(admin).length === beforeMuteAdmin, "admin actor still skips self when only manager muted");

console.log(`Blacklist create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
