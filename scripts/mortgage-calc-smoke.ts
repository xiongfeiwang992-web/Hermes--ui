import path from "node:path";
import { seedDatabase } from "./seed";
import { createApp } from "../server/createApp";

const app = createApp(seedDatabase(path.resolve("data", "mortgage-calc-smoke.db")).dbPath);
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

const agent = login("agent_a");
const finance = login("finance");

assert(
  !app.call(
    "mortgageCalc.compute",
    { principal: 0, months: 360, lpr: 3.45, method: "equal_installment" },
    agent
  ).ok,
  "reject zero principal"
);
assert(
  !app.call(
    "mortgageCalc.compute",
    { principal: 1000000, months: 0, lpr: 3.45, method: "equal_installment" },
    agent
  ).ok,
  "reject invalid months"
);
assert(
  !app.call(
    "mortgageCalc.compute",
    { principal: 1000000, months: 360, lpr: 3.45, method: "other" },
    agent
  ).ok,
  "reject invalid method"
);

const installment = app.call(
  "mortgageCalc.compute",
  {
    principal: 1000000,
    months: 360,
    lpr: 3.45,
    basis_points: 0,
    method: "equal_installment",
  },
  agent
);
assert(installment.ok, "compute equal installment");
const installmentData = data<any>(installment);
assert(installmentData.schedule.length === 360, "installment schedule length");
assert(installmentData.annual_rate === 3.45, "installment annual rate from LPR");
assert(
  Math.abs(installmentData.first_payment - installmentData.last_payment) < 0.02,
  "equal installment nearly flat payment"
);
assert(installmentData.total_interest > 0, "installment has interest");
assert(
  Math.abs(installmentData.total_payment - (1000000 + installmentData.total_interest)) < 0.02,
  "installment total = principal + interest"
);
assert(
  Math.abs(installmentData.schedule[359].remaining) < 0.02,
  "installment remaining clears"
);

const withBp = app.call(
  "mortgageCalc.compute",
  {
    principal: 1000000,
    months: 360,
    lpr: 3.45,
    basis_points: 20,
    method: "equal_installment",
  },
  agent
);
assert(withBp.ok, "compute with BP");
assert(data<any>(withBp).annual_rate === 3.65, "annual rate = LPR + BP/100");
assert(
  data<any>(withBp).first_payment > installmentData.first_payment,
  "higher rate increases payment"
);

const byAnnual = app.call(
  "mortgageCalc.compute",
  {
    principal: 500000,
    months: 120,
    annual_rate: 4.2,
    method: "equal_installment",
  },
  finance
);
assert(byAnnual.ok, "finance can compute with annual rate");
assert(data<any>(byAnnual).annual_rate === 4.2, "direct annual rate honored");

const principalMethod = app.call(
  "mortgageCalc.compute",
  {
    principal: 1200000,
    months: 24,
    lpr: 3.6,
    method: "equal_principal",
  },
  agent
);
assert(principalMethod.ok, "compute equal principal");
const principalData = data<any>(principalMethod);
assert(principalData.schedule.length === 24, "equal principal schedule length");
assert(
  principalData.first_payment > principalData.last_payment,
  "equal principal declining payment"
);
assert(
  Math.abs(principalData.schedule[0].principal - principalData.schedule[1].principal) < 0.02,
  "equal principal fixed principal part"
);
assert(Math.abs(principalData.schedule[23].remaining) < 0.02, "equal principal remaining clears");

const zeroRate = app.call(
  "mortgageCalc.compute",
  {
    principal: 120000,
    months: 12,
    annual_rate: 0.0001,
    method: "equal_installment",
  },
  agent
);
assert(zeroRate.ok, "tiny rate still computes");

console.log(`Mortgage calc smoke result: passed=${passed} failed=${failed}`);
if (failed) process.exit(1);
