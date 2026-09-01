import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "salary-profile-notify-smoke.db")).dbPath
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
const profileMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "payroll" && m.title === "薪资档案已更新"
  );

const admin = login("admin");
const agent = login("agent_a");
const peer = login("agent_b");
const agentId = data<any>(app.call("auth.me", {}, agent)).id;
const peerId = data<any>(app.call("auth.me", {}, peer)).id;

const beforeAgent = profileMsgs(agent).length;
const beforeAdmin = profileMsgs(admin).length;
const saved = app.call(
  "payroll.profiles.save",
  {
    user_id: agentId,
    base_salary: 5200,
    fixed_allowance: 300,
    fixed_deduction: 50,
    bank_name: "通知银行",
    bank_account: "6222000099998888",
  },
  admin
);
assert(saved.ok, "admin saves salary profile");
assert(profileMsgs(agent).length === beforeAgent + 1, "agent receives profile message");
assert(profileMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(
  profileMsgs(agent).some(
    (m) =>
      m.ref_id === agentId &&
      String(m.body).includes("5200") &&
      String(m.body).includes("300")
  ),
  "profile message body"
);

const beforeUpdate = profileMsgs(agent).length;
assert(
  app.call(
    "payroll.profiles.save",
    {
      user_id: agentId,
      base_salary: 5300,
      fixed_allowance: 350,
      fixed_deduction: 50,
      bank_name: "通知银行",
      bank_account: "6222000099998888",
    },
    admin
  ).ok,
  "admin updates salary profile"
);
assert(profileMsgs(agent).length === beforeUpdate + 1, "update also notifies employee");

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, agent).ok,
  "mute hr"
);
const beforeMute = profileMsgs(agent).length;
const beforePeer = profileMsgs(peer).length;
assert(
  app.call(
    "payroll.profiles.save",
    {
      user_id: agentId,
      base_salary: 5400,
      fixed_allowance: 400,
      fixed_deduction: 50,
      bank_name: "通知银行",
      bank_account: "6222000099998888",
    },
    admin
  ).ok,
  "save while muted"
);
assert(profileMsgs(agent).length === beforeMute, "muted hr suppresses message");
assert(
  app.call(
    "payroll.profiles.save",
    {
      user_id: peerId,
      base_salary: 4100,
      fixed_allowance: 100,
      fixed_deduction: 0,
      bank_name: "通知银行",
      bank_account: "6222000077776666",
    },
    admin
  ).ok,
  "save peer profile"
);
assert(profileMsgs(peer).length === beforePeer + 1, "peer still receives when agent muted");

console.log(`Salary profile notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
