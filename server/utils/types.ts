export type Role = "admin" | "store_manager" | "agent" | "finance";

export type SessionUser = {
  id: string;
  company_id: string;
  store_id: string;
  account: string;
  display_name: string;
  role: Role;
  phone: string | null;
  status: string;
};

export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; message: string; code?: number };

export const ROLES: Role[] = ["admin", "store_manager", "agent", "finance"];

export const HOUSE_STATUSES = [
  "draft",
  "available",
  "suspended",
  "deal_pending",
  "closed",
  "withdrawn",
] as const;

export const CUSTOMER_STATUSES = [
  "new",
  "following",
  "viewing",
  "deal_pending",
  "closed",
  "invalid",
  "public_pool",
] as const;
