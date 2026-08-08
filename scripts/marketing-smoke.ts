import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const seeded = seedDatabase(path.resolve("data", "marketing-smoke.db"));
const app = createApp(seeded.dbPath);
let passed = 0;
let failed = 0;
const check = (value: unknown, label: string) => {
  if (value) passed++;
  else {
    failed++;
    console.error("FAIL:", label);
  }
};
const data = <T = any>(result: any) => result.data as T;
const login = (account: string) => {
  const result = app.call("auth.login", { account, password: "123456" });
  check(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const admin = login("admin");
const manager = login("manager");
const agentA = login("agent_a");
const agentB = login("agent_b");
const finance = login("finance");
const agentC = login("agent_c");
const agentAUser = data<any>(app.call("auth.me", {}, agentA));
const agentBUser = data<any>(app.call("auth.me", {}, agentB));

check(
  data<any>(app.call("marketing.options", {}, finance)).campaigns.length === 0,
  "finance receives empty marketing options"
);
check(
  !app.call(
    "marketing.campaigns.create",
    {
      name: "越权活动",
      channel: "wechat",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      budget: 1000,
    },
    agentA
  ).ok,
  "agent cannot create marketing campaign"
);
check(
  !app.call(
    "marketing.campaigns.create",
    {
      name: "无效渠道",
      channel: "tiktok",
      start_date: "2026-08-01",
      end_date: "2026-08-31",
      budget: 1000,
    },
    manager
  ).ok,
  "campaign channel validated"
);
check(
  !app.call(
    "marketing.campaigns.create",
    {
      name: "日期反转",
      channel: "wechat",
      start_date: "2026-08-31",
      end_date: "2026-08-01",
      budget: 1000,
    },
    manager
  ).ok,
  "campaign date range validated"
);
const campaign = app.call(
  "marketing.campaigns.create",
  {
    name: "八月微信获客",
    channel: "wechat",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    budget: 5000,
  },
  manager
);
check(campaign.ok && data<any>(campaign).status === "draft", "manager creates campaign draft");
const campaignId = data<any>(campaign).id;
check(
  !app.call(
    "marketing.leads.create",
    {
      contact_name: "活动线索",
      contact_phone: "13980001111",
      intent: "buy",
      channel: "campaign",
      campaign_id: campaignId,
    },
    manager
  ).ok,
  "inactive campaign cannot accept leads"
);
check(
  app.call("marketing.campaigns.status", { id: campaignId, status: "active" }, manager).ok,
  "manager activates campaign"
);
check(
  data<any[]>(app.call("marketing.campaigns.list", {}, agentA)).some(
    (item) => item.id === campaignId && item.status === "active"
  ),
  "same-store agent sees active campaign"
);
check(
  !data<any[]>(app.call("marketing.campaigns.list", {}, agentC)).some(
    (item) => item.id === campaignId
  ),
  "other-store agent does not see store campaign"
);

check(
  !app.call(
    "marketing.leads.create",
    {
      contact_name: "无效手机",
      contact_phone: "123",
      intent: "buy",
      channel: "wechat",
    },
    agentA
  ).ok,
  "lead phone validated"
);
check(
  app.call(
    "blacklist.add",
    { kind: "lead", value: "13980002222", reason: "虚假线索" },
    manager
  ).ok,
  "manager adds lead blacklist entry"
);
check(
  !app.call(
    "marketing.leads.create",
    {
      contact_name: "黑名单线索",
      contact_phone: "13980002222",
      intent: "buy",
      channel: "phone",
    },
    agentA
  ).ok,
  "blacklisted lead phone rejected"
);
const lead = app.call(
  "marketing.leads.create",
  {
    contact_name: "张线索",
    contact_phone: "13980001111",
    intent: "buy",
    channel: "campaign",
    campaign_id: campaignId,
    need: "两室刚需",
    budget_note: "200万内",
    assignee_user_id: agentAUser.id,
  },
  manager
);
check(lead.ok && data<any>(lead).status === "new", "manager creates campaign lead");
const leadId = data<any>(lead).id;
check(
  !app.call(
    "marketing.leads.create",
    {
      contact_name: "重复线索",
      contact_phone: "13980001111",
      intent: "rent",
      channel: "phone",
    },
    agentB
  ).ok,
  "open lead phone is company-unique"
);
check(
  data<any[]>(app.call("marketing.leads.list", {}, agentA)).some(
    (item) => item.id === leadId && item.contact_phone === "13980001111"
  ),
  "assigned agent sees lead phone in cleartext"
);
check(
  data<any[]>(app.call("marketing.leads.list", {}, agentB)).length === 0,
  "unassigned agent cannot see other lead"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === leadId && message.kind === "marketing"
  ),
  "assignee receives lead assignment message"
);
check(
  !app.call("marketing.leads.status", { id: leadId, status: "qualified" }, agentA).ok,
  "lead cannot jump from new to qualified"
);
check(
  app.call("marketing.leads.status", { id: leadId, status: "contacting" }, agentA).ok,
  "assignee starts contacting lead"
);
check(
  app.call("marketing.leads.status", { id: leadId, status: "qualified" }, agentA).ok,
  "assignee qualifies contacted lead"
);
check(
  !app.call("marketing.leads.convert", { id: leadId }, agentB).ok,
  "unrelated agent cannot convert lead"
);
const converted = app.call("marketing.leads.convert", { id: leadId }, agentA);
check(
  converted.ok && data<any>(converted).status === "converted",
  "assignee converts qualified lead to customer"
);
const customerId = data<any>(converted).customer_id;
const customer = app.call("customer.get", { id: customerId }, agentA);
check(
  customer.ok &&
    data<any>(customer).phone === "13980001111" &&
    data<any>(customer).visibility === "private" &&
    data<any>(customer).agent_id === agentAUser.id,
  "converted customer inherits private ownership"
);
check(
  !app.call("marketing.leads.convert", { id: leadId }, agentA).ok,
  "converted lead cannot convert twice"
);
const hinted = app.call(
  "marketing.leads.create",
  {
    contact_name: "同号新线索",
    contact_phone: "13980001111",
    intent: "buy",
    channel: "phone",
    assignee_user_id: agentBUser.id,
  },
  manager
);
check(
  hinted.ok && data<any>(hinted).existing_customer_hint?.id === customerId,
  "new lead on converted phone returns existing customer hint"
);

const lostLead = app.call(
  "marketing.leads.create",
  {
    contact_name: "流失线索",
    contact_phone: "13980003333",
    intent: "rent",
    channel: "walk_in",
  },
  agentA
);
const lostLeadId = data<any>(lostLead).id;
check(lostLead.ok, "agent creates self-assigned walk-in lead");
check(
  data<any[]>(app.call("marketing.leads.list", {}, agentA)).find(
    (item) => item.id === lostLeadId
  )?.assignee_user_id === agentAUser.id,
  "agent-created lead auto-assigns to self"
);
check(
  !app.call(
    "marketing.leads.status",
    { id: lostLeadId, status: "lost", reason: "" },
    agentA
  ).ok,
  "lost lead requires reason"
);
check(
  app.call(
    "marketing.leads.status",
    { id: lostLeadId, status: "contacting" },
    agentA
  ).ok &&
    app.call(
      "marketing.leads.status",
      { id: lostLeadId, status: "lost", reason: "预算不符" },
      agentA
    ).ok,
  "agent marks contacted lead as lost with reason"
);

const entrustment = app.call(
  "marketing.entrustments.create",
  {
    entrust_type: "sell",
    contact_name: "在线业主",
    contact_phone: "13980004444",
    community: "营销花园",
    address: "3栋201",
    expected_price: 280,
    rooms: "3室2厅",
    area_size: 98,
    content: "希望尽快委托出售",
  },
  agentB
);
check(entrustment.ok && data<any>(entrustment).status === "new", "agent registers online entrustment");
const entrustmentId = data<any>(entrustment).id;
check(
  data<any[]>(app.call("message.list", {}, manager)).some(
    (message) => message.ref_id === entrustmentId
  ),
  "manager receives online entrustment message"
);
check(
  !app.call(
    "marketing.entrustments.accept",
    { id: entrustmentId, assignee_user_id: agentAUser.id },
    agentB
  ).ok,
  "agent cannot accept online entrustment"
);
check(
  !app.call(
    "marketing.entrustments.reject",
    { id: entrustmentId, reason: "" },
    manager
  ).ok,
  "entrustment rejection requires reason"
);
const accepted = app.call(
  "marketing.entrustments.accept",
  { id: entrustmentId, assignee_user_id: agentAUser.id },
  manager
);
check(
  accepted.ok && data<any>(accepted).status === "converted",
  "manager accepts online entrustment into lead"
);
const fromEntrustmentLeadId = data<any>(accepted).lead_id;
check(
  data<any[]>(app.call("marketing.leads.list", {}, agentA)).some(
    (item) => item.id === fromEntrustmentLeadId && item.channel === "website"
  ),
  "accepted entrustment creates website lead for assignee"
);
check(
  data<any[]>(app.call("message.list", {}, agentA)).some(
    (message) => message.ref_id === fromEntrustmentLeadId
  ),
  "assignee receives entrustment-to-lead message"
);
check(
  !app.call(
    "marketing.entrustments.accept",
    { id: entrustmentId, assignee_user_id: agentAUser.id },
    manager
  ).ok,
  "converted entrustment cannot accept twice"
);

const rejectedEntrustment = app.call(
  "marketing.entrustments.create",
  {
    entrust_type: "rent",
    contact_name: "驳回委托",
    contact_phone: "13980005555",
    content: "信息不全",
  },
  agentA
);
const rejectedId = data<any>(rejectedEntrustment).id;
check(rejectedEntrustment.ok, "create entrustment for rejection");
check(
  app.call(
    "marketing.entrustments.reject",
    { id: rejectedId, reason: "联系方式无效" },
    manager
  ).ok,
  "manager rejects incomplete online entrustment"
);

check(
  app.call("marketing.campaigns.status", { id: campaignId, status: "closed" }, manager).ok,
  "manager closes active campaign"
);
check(
  !app.call(
    "marketing.leads.create",
    {
      contact_name: "关闭后线索",
      contact_phone: "13980006666",
      intent: "buy",
      channel: "campaign",
      campaign_id: campaignId,
    },
    manager
  ).ok,
  "closed campaign rejects new leads"
);

const events = app.call(
  "marketing.events",
  { entity_type: "lead", entity_id: leadId },
  agentA
);
check(
  events.ok &&
    data<any[]>(events).some((event) => event.event_type === "qualified") &&
    data<any[]>(events).some((event) => event.event_type === "converted"),
  "lead event history includes qualification and conversion"
);
check(
  !app.call(
    "marketing.events",
    { entity_type: "lead", entity_id: leadId },
    agentC
  ).ok,
  "other-store agent cannot inspect lead events"
);
check(
  data<any[]>(app.call("marketing.leads.list", {}, finance)).length === 0,
  "finance cannot read marketing leads"
);
for (const type of ["website_page", "online_entrustment", "lead", "campaign"]) {
  check(
    !app.call(
      "suite.create",
      {
        module: "marketing",
        record_type: type,
        title: `通用${type}`,
        data: {},
      },
      manager
    ).ok,
    `generic marketing type ${type} disabled`
  );
}
const audits = data<any[]>(
  app.call("audit.list", { entity_type: "marketing_lead" }, admin)
);
check(
  audits.some((item) => item.action === "marketing.lead.convert"),
  "marketing lead conversion writes audit log"
);

console.log(`Marketing smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
