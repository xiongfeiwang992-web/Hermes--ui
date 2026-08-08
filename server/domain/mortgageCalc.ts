import type { Db } from "../db/database";
import type { ApiResult, SessionUser } from "../utils/types";

export type MortgageMethod = "equal_installment" | "equal_principal";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function resolveAnnualRate(payload: any): { ok: true; rate: number } | { ok: false; message: string } {
  if (payload.annual_rate != null && payload.annual_rate !== "") {
    const rate = Number(payload.annual_rate);
    if (!(rate > 0) || rate > 30) return { ok: false, message: "年利率须为 0～30 之间的正数" };
    return { ok: true, rate };
  }
  const lpr = Number(payload.lpr);
  const bp = Number(payload.basis_points ?? 0);
  if (!(lpr > 0) || lpr > 30) return { ok: false, message: "LPR 须为 0～30 之间的正数" };
  if (!Number.isFinite(bp) || bp < -500 || bp > 500)
    return { ok: false, message: "基点 BP 须为 -500～500" };
  return { ok: true, rate: lpr + bp / 100 };
}

export function computeMortgage(
  _db: Db,
  _user: SessionUser,
  payload: any
): ApiResult {
  const principal = Number(payload.principal);
  const months = Number(payload.months);
  const method = payload.method as MortgageMethod;
  if (!(principal > 0) || principal > 1e9) {
    return { ok: false, message: "贷款本金须大于 0" };
  }
  if (!Number.isInteger(months) || months < 1 || months > 600) {
    return { ok: false, message: "贷款期限须为 1～600 个月" };
  }
  if (!["equal_installment", "equal_principal"].includes(method)) {
    return { ok: false, message: "还款方式无效" };
  }
  const rateResult = resolveAnnualRate(payload);
  if (!rateResult.ok) return rateResult;
  const annualRate = rateResult.rate;
  const monthlyRate = annualRate / 100 / 12;

  const schedule: Array<{
    period: number;
    payment: number;
    principal: number;
    interest: number;
    remaining: number;
  }> = [];

  if (method === "equal_installment") {
    const factor = Math.pow(1 + monthlyRate, months);
    const payment = monthlyRate === 0
      ? principal / months
      : (principal * monthlyRate * factor) / (factor - 1);
    let remaining = principal;
    for (let period = 1; period <= months; period++) {
      const interest = remaining * monthlyRate;
      let principalPart = payment - interest;
      if (period === months) principalPart = remaining;
      const actualPayment = principalPart + interest;
      remaining = Math.max(0, remaining - principalPart);
      schedule.push({
        period,
        payment: round2(actualPayment),
        principal: round2(principalPart),
        interest: round2(interest),
        remaining: round2(remaining),
      });
    }
  } else {
    const principalPart = principal / months;
    let remaining = principal;
    for (let period = 1; period <= months; period++) {
      const interest = remaining * monthlyRate;
      const actualPrincipal = period === months ? remaining : principalPart;
      const payment = actualPrincipal + interest;
      remaining = Math.max(0, remaining - actualPrincipal);
      schedule.push({
        period,
        payment: round2(payment),
        principal: round2(actualPrincipal),
        interest: round2(interest),
        remaining: round2(remaining),
      });
    }
  }

  const totalPayment = round2(schedule.reduce((sum, row) => sum + row.payment, 0));
  const totalInterest = round2(totalPayment - principal);
  return {
    ok: true,
    data: {
      principal: round2(principal),
      months,
      method,
      annual_rate: round2(annualRate),
      monthly_rate: round2(monthlyRate * 10000) / 10000,
      first_payment: schedule[0]?.payment ?? 0,
      last_payment: schedule[schedule.length - 1]?.payment ?? 0,
      total_payment: totalPayment,
      total_interest: totalInterest,
      schedule,
    },
  };
}
