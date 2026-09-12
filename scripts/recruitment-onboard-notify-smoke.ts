import fs from "node:fs";
import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(
  seedDatabase(path.resolve("data", "recruitment-onboard-notify-smoke.db")).dbPath
);
const resumePath = path.resolve("/tmp", "recruitment-onboard-notify-resume.txt");
fs.writeFileSync(resumePath, "recruitment onboard notify resume");

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
const login = (account: string, password = "123456") => {
  const result = app.call("auth.login", { account, password });
  assert(result.ok, `${account} login`);
  return result.ok ? data<any>(result).token : "";
};
const hireMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "recruitment" && m.title === "候选人已入职"
  );
const welcomeMsgs = (token: string) =>
  data<any[]>(app.call("message.list", {}, token)).filter(
    (m) => m.kind === "recruitment" && m.title === "欢迎入职"
  );

const admin = login("admin");
const manager = login("manager");
const options = app.call("recruitment.options", {}, admin);
assert(options.ok, "admin recruitment options");
const storeA = data<any>(options).stores.find((store: any) => store.name === "一号店").id;

function prepareOfferCandidate(name: string, phone: string, title: string) {
  const job = app.call(
    "recruitment.jobs.save",
    {
      title,
      store_id: storeA,
      target_role: "agent",
      headcount: 2,
    },
    manager
  );
  assert(job.ok, `create job ${title}`);
  const candidate = app.call(
    "recruitment.candidates.create",
    { job_id: data<any>(job).id, name, phone, source: "站内" },
    manager
  );
  assert(candidate.ok, `create candidate ${name}`);
  const candidateId = data<any>(candidate).id;
  assert(
    app.call(
      "recruitment.candidates.status",
      { id: candidateId, status: "screening" },
      manager
    ).ok,
    `${name} screening`
  );
  assert(
    app.call(
      "attachment.add",
      {
        parent_type: "recruitment_candidate",
        parent_id: candidateId,
        category: "resume",
        name: `${name}-resume.txt`,
        local_path: resumePath,
      },
      manager
    ).ok,
    `${name} resume`
  );
  assert(
    app.call(
      "recruitment.candidates.status",
      {
        id: candidateId,
        status: "interview",
        interview_at: "2026-09-01T10:00:00.000Z",
      },
      manager
    ).ok,
    `${name} interview`
  );
  assert(
    app.call(
      "recruitment.candidates.status",
      { id: candidateId, status: "offer" },
      manager
    ).ok,
    `${name} offer`
  );
  return candidateId;
}

const candidateId = prepareOfferCandidate("入职通知甲", "13951110001", "入职通知岗");
const beforeManager = hireMsgs(manager).length;
const beforeAdmin = hireMsgs(admin).length;
const onboarded = app.call(
  "recruitment.candidates.onboard",
  {
    id: candidateId,
    account: "onboard_notify_a",
    display_name: "入职员工甲",
    password: "onboard-pass-1",
  },
  admin
);
assert(onboarded.ok && data<any>(onboarded).status === "hired", "admin onboards candidate");
assert(hireMsgs(manager).length === beforeManager + 1, "creator receives hire message");
assert(hireMsgs(admin).length === beforeAdmin, "admin actor does not get hire message");
assert(
  hireMsgs(manager).some(
    (m) =>
      m.ref_id === candidateId &&
      String(m.body).includes("入职通知甲") &&
      String(m.body).includes("入职员工甲") &&
      String(m.body).includes("onboard_notify_a")
  ),
  "hire message body"
);

const newEmployee = login("onboard_notify_a", "onboard-pass-1");
assert(welcomeMsgs(newEmployee).length === 1, "new employee receives welcome");
assert(
  welcomeMsgs(newEmployee).some(
    (m) =>
      m.ref_id === candidateId &&
      String(m.body).includes("onboard_notify_a") &&
      String(m.body).includes("agent")
  ),
  "welcome message body"
);

assert(
  app.call("message.subscriptions.save", { channels: { hr: false } }, manager).ok,
  "mute hr"
);
const mutedId = prepareOfferCandidate("静音入职乙", "13951110002", "静音入职岗");
const beforeMute = hireMsgs(manager).length;
assert(
  app.call(
    "recruitment.candidates.onboard",
    {
      id: mutedId,
      account: "onboard_notify_b",
      display_name: "入职员工乙",
      password: "onboard-pass-2",
    },
    admin
  ).ok,
  "onboard while muted"
);
assert(hireMsgs(manager).length === beforeMute, "muted hr suppresses hire message");
const mutedEmployee = login("onboard_notify_b", "onboard-pass-2");
assert(welcomeMsgs(mutedEmployee).length === 1, "welcome still sent to new employee");

console.log(
  `Recruitment onboard notify smoke result: passed=${passed} failed=${failed}`
);
process.exit(failed ? 1 : 0);
