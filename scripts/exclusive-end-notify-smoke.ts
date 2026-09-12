import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "exclusive-end-notify-smoke.db")).dbPath
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
const endMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      (m.title === "包销已结束" || m.title === "独家代理已结束")
  );

const manager = login("manager");
const agent = login("agent_a");

function createActiveExclusive(
  title: string,
  agencyType: "package" | "exclusive",
  phoneSuffix: string,
  byToken: string
) {
  const house = app.call(
    "house.create",
    {
      title,
      deal_type: "sale",
      community: "独家结束小区",
      price: 300,
      owner_name: "独家结束业主",
      owner_phone: `1376${phoneSuffix}`,
      status: "available",
    },
    byToken
  );
  assert(house.ok, `create house ${title}`);
  const houseId = data<any>(house).id;
  const payload: any = {
    house_id: houseId,
    agency_type: agencyType,
    start_date: "2026-08-01",
    end_date: "2027-08-01",
    commission_rule: "结束通知测试",
  };
  if (agencyType === "package") payload.package_price = 260;
  assert(
    app.call("propertyExt.exclusive.save", payload, byToken).ok,
    `save ${title}`
  );
  assert(
    app.call("propertyExt.exclusive.activate", { house_id: houseId }, byToken).ok,
    `activate ${title}`
  );
  return houseId;
}

const packageHouseId = createActiveExclusive(
  "包销结束通知盘",
  "package",
  "0000401",
  agent
);
assert(
  !app.call(
    "propertyExt.exclusive.end",
    { house_id: packageHouseId, reason: "短" },
    manager
  ).ok,
  "end reason min length"
);

const beforeAgent = endMsgs(agent).length;
const beforeManager = endMsgs(manager).length;
const ended = app.call(
  "propertyExt.exclusive.end",
  { house_id: packageHouseId, reason: "包销到期结束" },
  manager
);
assert(ended.ok, "manager ends agent package exclusive");
assert(data<any>(ended).status === "ended", "status ended");

const afterAgent = endMsgs(agent);
assert(afterAgent.length === beforeAgent + 1, "agent receives end message");
assert(afterAgent[0].ref_id === packageHouseId, "message refs house");
assert(afterAgent[0].title === "包销已结束", "package end title");
assert(String(afterAgent[0].body).includes("包销结束通知盘"), "body has house title");
assert(String(afterAgent[0].body).includes("包销到期结束"), "body has reason");
assert(endMsgs(manager).length === beforeManager, "ender does not self-notify");
assert(
  !app.call(
    "propertyExt.exclusive.end",
    { house_id: packageHouseId, reason: "再次结束" },
    manager
  ).ok,
  "cannot end twice"
);

const selfHouseId = createActiveExclusive(
  "自行结束独家盘",
  "exclusive",
  "0000402",
  agent
);
const beforeSelf = endMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.end",
    { house_id: selfHouseId, reason: "接盘人自行结束独家" },
    agent
  ).ok,
  "agent ends own exclusive"
);
assert(endMsgs(agent).length === beforeSelf, "self-end does not notify agent");

const muteHouseId = createActiveExclusive(
  "静音结束包销盘",
  "package",
  "0000403",
  agent
);
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other channel"
);
const beforeMute = endMsgs(agent).length;
assert(
  app.call(
    "propertyExt.exclusive.end",
    { house_id: muteHouseId, reason: "静音场景结束" },
    manager
  ).ok,
  "end while agent muted"
);
assert(endMsgs(agent).length === beforeMute, "muted other suppresses end message");

console.log(`Exclusive end notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
