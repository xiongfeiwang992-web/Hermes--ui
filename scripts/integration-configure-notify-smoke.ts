import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "integration-configure-notify-smoke.db")).dbPath
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
const cfgMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "business_record_status" && m.title === "外部集成配置已变更"
  );

const admin = login("admin");
const manager = login("manager");
const agent = login("agent_a");

assert(
  !app.call(
    "integration.configure",
    { provider: "map", enabled: false, endpoint: "" },
    manager
  ).ok,
  "manager cannot configure integration"
);
assert(
  !app.call(
    "integration.configure",
    {
      provider: "ca_esign",
      enabled: true,
      endpoint: "http://unsafe.example.com",
    },
    admin
  ).ok,
  "enabled adapter requires HTTPS"
);

const beforeAdmin = cfgMsgs(admin).length;
const beforeManager = cfgMsgs(manager).length;
const beforeAgent = cfgMsgs(agent).length;
const created = app.call(
  "integration.configure",
  {
    provider: "sms",
    enabled: false,
    endpoint: "",
    credential_ref: "SMS_SECRET",
  },
  admin
);
assert(created.ok, "admin saves disabled sms adapter");
const cfgId = data<any>(created).id;
assert(cfgMsgs(admin).length === beforeAdmin, "admin actor skips self");
assert(cfgMsgs(manager).length === beforeManager + 1, "manager receives configure message");
assert(cfgMsgs(agent).length === beforeAgent, "agent not notified");
assert(
  cfgMsgs(manager).some(
    (m) =>
      m.ref_id === cfgId &&
      m.ref_type === "integration" &&
      String(m.body).includes("sms") &&
      String(m.body).includes("已停用")
  ),
  "configure message body"
);

const beforeUpdate = cfgMsgs(manager).length;
assert(
  app.call(
    "integration.configure",
    {
      provider: "sms",
      enabled: true,
      endpoint: "https://sms.example.com/api",
      credential_ref: "SMS_SECRET",
    },
    admin
  ).ok,
  "admin enables sms adapter"
);
assert(cfgMsgs(manager).length === beforeUpdate + 1, "update also notifies");
assert(
  cfgMsgs(manager).some((m) => String(m.body).includes("已启用")),
  "enable body says enabled"
);

assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, manager).ok,
  "mute other"
);
const beforeMute = cfgMsgs(manager).length;
assert(
  app.call(
    "integration.configure",
    {
      provider: "wechat",
      enabled: false,
      endpoint: "",
      credential_ref: "WX_SECRET",
    },
    admin
  ).ok,
  "configure while muted"
);
assert(cfgMsgs(manager).length === beforeMute, "muted other suppresses configure message");

console.log(`Integration configure notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
