import type { Db } from "../db/database";
import type { SessionUser } from "../utils/types";

export type ContactGateSettings = {
  force_follow_before_phone: number;
  non_holder_view_remind: number;
};

export function getContactGateSettings(db: Db, companyId: string): ContactGateSettings {
  const row = db
    .prepare(
      `SELECT force_follow_before_phone, non_holder_view_remind FROM settings WHERE company_id = ?`
    )
    .get(companyId) as ContactGateSettings | undefined;
  return {
    force_follow_before_phone: Number(row?.force_follow_before_phone || 0),
    non_holder_view_remind: Number(row?.non_holder_view_remind ?? 1),
  };
}

export function hasFollowUnlock(
  db: Db,
  user: SessionUser,
  targetType: "house" | "customer",
  targetId: string
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM follows
       WHERE company_id = ? AND target_type = ? AND target_id = ?
         AND created_by = ? AND voided = 0
       LIMIT 1`
    )
    .get(user.company_id, targetType, targetId, user.id);
  return Boolean(row);
}

/** Agents must unlock via follow when the company enables force-follow; managers/admins are exempt. */
export function resolvePhoneVisibility(
  db: Db,
  user: SessionUser,
  policyAllows: boolean,
  targetType: "house" | "customer",
  targetId: string
): { showFull: boolean; forceFollowRequired: boolean } {
  if (!policyAllows) {
    return { showFull: false, forceFollowRequired: false };
  }
  if (user.role !== "agent") {
    return { showFull: true, forceFollowRequired: false };
  }
  const settings = getContactGateSettings(db, user.company_id);
  if (!settings.force_follow_before_phone) {
    return { showFull: true, forceFollowRequired: false };
  }
  const unlocked = hasFollowUnlock(db, user, targetType, targetId);
  return { showFull: unlocked, forceFollowRequired: !unlocked };
}
