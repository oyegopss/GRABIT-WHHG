import "server-only";

import { createClient } from "./client";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { CanteenActiveOffer } from "@/lib/supabase/data";

interface SupabasePromoCodeRow {
  id: string;
  code: string;
  description: string | null;
  discount_type: "PERCENTAGE" | "FLAT";
  discount_value: number;
  max_discount: number | null;
  min_order_value: number;
  usage_limit: number | null;
  starts_at: string | null;
  expires_at: string | null;
}

/**
 * Live, canteen-scoped active offers for the student-facing vendor page.
 * Reads the SAME `promo_codes` table used by Vendor Offers and checkout
 * coupon validation — no separate "display" copy. Only offers that are
 * published, active, within their start/expiry window, and (if capped)
 * under their total redemption limit are returned; historical/expired
 * rows are never deleted, just excluded from this student-facing read.
 *
 * NOTE: Marked server-only because cross-student aggregate redemption counts
 * require service-role access (RLS scopes promo_code_redemptions to a student's own rows).
 */
export async function getLiveCanteenActiveOffers(canteenId: string): Promise<CanteenActiveOffer[]> {
  const supabase = createClient();

  const { data: promoCodes } = await supabase
    .from("promo_codes")
    .select("id, code, description, discount_type, discount_value, max_discount, min_order_value, usage_limit, starts_at, expires_at")
    .eq("canteen_id", canteenId)
    .eq("is_published", true)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (!promoCodes || promoCodes.length === 0) {
    return [];
  }

  const now = Date.now();
  const inWindow = (promoCodes as SupabasePromoCodeRow[]).filter((p) => {
    if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
    if (p.expires_at && new Date(p.expires_at).getTime() < now) return false;
    return true;
  });

  if (inWindow.length === 0) {
    return [];
  }

  // Redemption counts are cross-student aggregates — RLS intentionally
  // scopes promo_code_redemptions reads to a student's own rows, so an
  // accurate total requires the service-role client here (same pattern
  // the vendor offers route already uses for the identical computation).
  const cappedIds = inWindow.filter((p) => p.usage_limit !== null).map((p) => p.id);
  const usageCounts = new Map<string, number>();
  if (cappedIds.length > 0) {
    const admin = getSupabaseAdminClient();
    const { data: redemptions } = await admin
      .from("promo_code_redemptions")
      .select("promo_code_id")
      .in("promo_code_id", cappedIds);
    (redemptions ?? []).forEach((r) => {
      usageCounts.set(r.promo_code_id, (usageCounts.get(r.promo_code_id) ?? 0) + 1);
    });
  }

  return inWindow
    .filter((p) => p.usage_limit === null || (usageCounts.get(p.id) ?? 0) < p.usage_limit)
    .map((p) => ({
      id: p.id,
      code: p.code,
      description: p.description,
      discountType: p.discount_type,
      discountValue: Number(p.discount_value),
      maxDiscount: p.max_discount !== null ? Number(p.max_discount) : null,
      minOrderValue: Number(p.min_order_value),
      expiresAt: p.expires_at,
    }));
}
