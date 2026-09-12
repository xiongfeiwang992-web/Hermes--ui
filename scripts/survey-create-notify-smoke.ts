import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "survey-create-notify-smoke.db")).dbPath
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
const surveyMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) =>
      m.kind === "business_record_status" &&
      (m.title === "实勘已完成" || m.title === "空看已完成")
  );

const manager = login("manager");
const agent = login("agent_a");
const peer = login("agent_b");

const house = app.call(
  "house.create",
  {
    title: "实勘通知房源",
    deal_type: "sale",
    community: "实勘小区",
    price: 220,
    owner_name: "实勘业主",
    owner_phone: "13694001111",
    status: "available",
  },
  agent
);
assert(house.ok, "create house");
const houseId = data<any>(house).id;

assert(
  !app.call(
    "property.surveys.create",
    { house_id: houseId, survey_type: "survey", summary: "" },
    peer
  ).ok,
  "summary required"
);

const beforeAgent = surveyMsgs(agent).length;
const beforePeer = surveyMsgs(peer).length;
const survey = app.call(
  "property.surveys.create",
  {
    house_id: houseId,
    survey_type: "survey",
    summary: "采光良好，装修保持完整",
  },
  peer
);
assert(survey.ok, "peer creates survey");
const surveyId = data<any>(survey).id;
assert(surveyMsgs(agent).length === beforeAgent + 1, "agent receives survey message");
assert(surveyMsgs(peer).length === beforePeer, "surveyor does not self-notify");
assert(
  surveyMsgs(agent).some(
    (m) =>
      m.ref_id === surveyId &&
      m.title === "实勘已完成" &&
      String(m.body).includes("实勘通知房源") &&
      String(m.body).includes("采光良好")
  ),
  "survey message body"
);

const vacant = app.call(
  "property.surveys.create",
  {
    house_id: houseId,
    survey_type: "vacant_view",
    summary: "空看确认可看",
  },
  manager
);
assert(vacant.ok, "manager creates vacant view");
assert(
  surveyMsgs(agent).some(
    (m) => m.ref_id === data<any>(vacant).id && m.title === "空看已完成"
  ),
  "vacant view title"
);

const selfHouse = app.call(
  "house.create",
  {
    title: "自行实勘房源",
    deal_type: "sale",
    community: "实勘小区",
    price: 210,
    owner_name: "自行业主",
    owner_phone: "13694002222",
    status: "available",
  },
  agent
);
assert(selfHouse.ok, "create self house");
const beforeSelf = surveyMsgs(agent).length;
assert(
  app.call(
    "property.surveys.create",
    {
      house_id: data<any>(selfHouse).id,
      survey_type: "survey",
      summary: "接盘人自行实勘",
    },
    agent
  ).ok,
  "agent self survey"
);
assert(surveyMsgs(agent).length === beforeSelf, "self survey skips notify");

const mutedHouse = app.call(
  "house.create",
  {
    title: "静音实勘房源",
    deal_type: "sale",
    community: "实勘小区",
    price: 205,
    owner_name: "静音业主",
    owner_phone: "13694003333",
    status: "available",
  },
  agent
);
assert(mutedHouse.ok, "create muted house");
assert(
  app.call("message.subscriptions.save", { channels: { other: false } }, agent).ok,
  "mute other"
);
const beforeMute = surveyMsgs(agent).length;
assert(
  app.call(
    "property.surveys.create",
    {
      house_id: data<any>(mutedHouse).id,
      survey_type: "survey",
      summary: "静音实勘测试",
    },
    peer
  ).ok,
  "survey while muted"
);
assert(surveyMsgs(agent).length === beforeMute, "muted other suppresses survey message");

console.log(`Survey create notify smoke result: passed=${passed} failed=${failed}`);
process.exit(failed ? 1 : 0);
