import { createHash } from "node:crypto";
import type { Db } from "../db/database";

/** Same sha256 hex hashing as `addBlacklist`; matches marketing lead/phone checks. */
export function isBlacklistedPhone(db: Db, companyId: string, phone: string): boolean {
  const value = String(phone || "").trim();
  if (!value) return false;
  const hash = createHash("sha256").update(value).digest("hex");
  return Boolean(
    db
      .prepare(
        `SELECT id FROM blacklists WHERE company_id=? AND status='active'
         AND kind IN ('phone', 'lead') AND value_hash=?`
      )
      .get(companyId, hash)
  );
}
