import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exclusive-activate-notify-smoke.db")).dbPath
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
const activateMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      (m.title === "包销已启用" || m.title === "独家代理已启用")
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

let phoneSeq = 800;
function prepareDraft(
  title: string,
  agencyType: "package" | "exclusive",
  byToken: string
) {
  phoneSeq += 1;
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "启用通知小区",
      price: 310,
      owner_name: "启用业主",
      owner_phone: `1378${String(phoneSeq).padStart(7, "0")}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create ${title}`);
  const houseId = data<any>(house).id;
  const payload: any = {
    house_id: houseId,
    agency_type: agencyType,
    start_date: "2026-09-01",
    end_date: "2027-09-01",
    commission_rule: "启用通知测试",
  };
  if (agencyType === "package") payload.package_price = 280;
  assert(
    app.call("propertyExt.exclusive.save", payload, byToken).ok,
    `save ${title}`
  );
  return houseId;
}

const packageId = prepareDraft("包销启用通知盘", "package", agent);
assert(
  !app.call("propertyExt.exclusive.activate", { house_id: packageId }, peer).ok,
  "peer cannot activate other agent exclusive"
);

const beforeAgent = activateMsgs(agent).length;
const beforeManager = activateMsgs(manager).length;
const activated = app.call(
  "propertyExt.exclusive.activate",
  { house_id: packageId },
  manager
);
assert(activated.ok, "manager activates package");
assert(data<any>(activated).status === "active", "status active");
const afterAgent = activateMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives activate message");
assert(afterAgent[0].ref_id === packageId, "message refs house");
assert(afterAgent[0].title === "包销已启用", "package activate title");
assert(String(afterAgent[0].body).includes("包销启用通知盘"), "body has house title");
assert(activateMsgs(manager).length === beforeManager, "activator does not self-notify");
assert(
  !app.call("propertyExt.exclusive.activate", { house_id: packageId }, manager).ok,
  "cannot activate twice"
);

const exclusiveId = prepareDraft("独家启用通知盘", "exclusive", agent);
const beforeEx = activateMsgs(agent).length;
assert(
  app.call("propertyExt.exclusive.activate", { house_id: exclusiveId }, manager).ok,
  "manager activates exclusive"
);
assert(
  activateMsgs(agent).some(
    (m) => m.ref_id === exclusiveId && m.title === "独家代理已启用"
  ),
  "exclusive activate title"
);
assert(activateMsgs(agent).length === beforeEx + 1, "exclusive notifies once");

const selfId = prepareDraft("自行启用包销盘", "package", agent);
const beforeSelf = activateMsgs(agent).length;
assert(
  app.call("propertyExt.exclusive.activate", { house_id: selfId }, agent).ok,
  "agent activates own package"
);
assert(activateMsgs(agent).length === beforeSelf, "self-activate skips notify");

const mutedId = prepareDraft("静音启用包销盘", "package", agent);
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = activateMsgs(agent).length;
assert(
  app.call("propertyExt.exclusive.activate", { house_id: mutedId }, manager).ok,
  "activate while muted"
);
assert(activateMsgs(agent).length === beforeMute, "muted other suppresses activate message");

console.log(
  `Exclusive activate notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
