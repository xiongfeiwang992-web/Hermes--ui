import type { SessionUser } from "../utils/types";

export function canManageOrg(user: SessionUser): boolean {
  return user.role === "admin";
}

export function canApproveDeal(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager";
}

export function canRegisterPayment(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "finance";
}

export function canWriteListing(user: SessionUser): boolean {
  return user.role === "admin" || user.role === "store_manager" || user.role === "agent";
}

export function canSeeCommissions(user: SessionUser): "all" | "store" | "self" | "none" {
  if (user.role === "admin" || user.role === "finance") return "all";
  if (user.role === "store_manager") return "store";
  if (user.role === "agent") return "self";
  return "none";
}

export function maskPhone(phone: string): string {
  if (!phone) return "";
  if (phone.length < 7) return "***";
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

export function canSeeOwnerPhone(
  user: SessionUser,
  house: { agent_id: string; store_id: string }
): boolean {
  if (user.role === "admin") return true;
  if (user.role === "store_manager" && user.store_id === house.store_id) return true;
  if (user.role === "agent" && user.id === house.agent_id) return true;
  return false;
}

export function houseVisibleTo(
  user: SessionUser,
  house: { store_id: string; agent_id: string; is_private: number | boolean }
): boolean {
  if (user.role === "finance") return false;
  if (user.role === "admin") return true;
  if (user.store_id !== house.store_id) return false;
  const isPrivate = Boolean(house.is_private);
  if (!isPrivate) return true;
  if (user.role === "store_manager") return true;
  return user.id === house.agent_id;
}

export function customerVisibleTo(
  user: SessionUser,
  customer: { store_id: string; agent_id: string; visibility: string }
): boolean {
  if (user.role === "finance") return false;
  if (user.role === "admin") return true;
  if (user.store_id !== customer.store_id) return false;
  if (user.role === "store_manager") return true;
  if (customer.visibility === "public") return true;
  return user.id === customer.agent_id;
}
