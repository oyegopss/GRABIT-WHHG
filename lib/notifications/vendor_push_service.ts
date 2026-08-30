import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { isFcmV1Configured, sendFcmV1Message } from "@/lib/notifications/fcm_v1";

export interface SendVendorOrderNotificationParams {
  orderId: string;
  orderNumber: string;
  canteenId: string;
  itemCount: number;
  totalAmount: number;
  slot?: string;
}

const PRIMARY_ORDERS_CHANNEL_ID = "grabit_new_orders";

interface TokenRecord {
  id: string;
  token: string;
  table: "vendor_device_tokens" | "student_device_tokens";
}

/**
 * Server-side push notification dispatcher for incoming vendor orders via FCM HTTP v1.
 * Dispatches high-priority Android notifications to registered vendor devices.
 * Completely failsafe: catches all errors so payment & order creation flows NEVER fail.
 */
export async function sendVendorNewOrderPushNotification(
  params: SendVendorOrderNotificationParams
): Promise<{ success: boolean; dispatchedCount: number }> {
  try {
    if (!isFcmV1Configured()) {
      console.warn("[vendor-push] FCM HTTP v1 is not configured (FCM_SERVICE_ACCOUNT_JSON missing).");
      return { success: true, dispatchedCount: 0 };
    }

    const supabase = getSupabaseAdminClient();
    const tokenRecords: TokenRecord[] = [];

    // 1. Try vendor_device_tokens table
    try {
      const { data: vendorTokens } = await supabase
        .from("vendor_device_tokens")
        .select("id, token")
        .eq("canteen_id", params.canteenId)
        .eq("is_active", true);

      if (vendorTokens && vendorTokens.length > 0) {
        vendorTokens.forEach((t) => {
          if (t.token) tokenRecords.push({ id: t.id, token: t.token, table: "vendor_device_tokens" });
        });
      }
    } catch {
      // Table might not exist yet
    }

    // 2. Also check vendor users for this canteen in student_device_tokens
    try {
      const { data: vendorUsers } = await supabase
        .from("users")
        .select("id")
        .eq("canteen_id", params.canteenId)
        .eq("role", "vendor");

      if (vendorUsers && vendorUsers.length > 0) {
        const userIds = vendorUsers.map((u) => u.id);
        const { data: fallbackTokens } = await supabase
          .from("student_device_tokens")
          .select("id, token")
          .in("user_id", userIds)
          .eq("is_active", true);

        if (fallbackTokens && fallbackTokens.length > 0) {
          fallbackTokens.forEach((t) => {
            if (t.token && !tokenRecords.some((existing) => existing.token === t.token)) {
              tokenRecords.push({ id: t.id, token: t.token, table: "student_device_tokens" });
            }
          });
        }
      }
    } catch (fallbackErr) {
      console.warn("[vendor-push] Error fetching fallback vendor tokens:", fallbackErr);
    }

    if (tokenRecords.length === 0) {
      console.info(`[vendor-push] No active device tokens found for canteenId=${params.canteenId}`);
      return { success: true, dispatchedCount: 0 };
    }

    // Deduplicate in-memory by token string to guarantee no physical device receives duplicates
    const uniqueTokens = Array.from(new Map(tokenRecords.map((t) => [t.token, t])).values());

    const title = "New Order Received";
    const body = `Order #${params.orderNumber} • ${params.itemCount} items (₹${params.totalAmount})`;

    console.info(
      `[vendor-push] Dispatching new order alert: orderId=${params.orderId}, orderNumber=${params.orderNumber}, canteenId=${params.canteenId}, activeDevices=${uniqueTokens.length}`
    );

    const results = await Promise.allSettled(
      uniqueTokens.map(async ({ id, token, table }) => {
        const result = await sendFcmV1Message({
          token,
          title,
          body,
          channelId: PRIMARY_ORDERS_CHANNEL_ID,
          data: {
            type: "NEW_ORDER",
            orderId: params.orderId,
            orderNumber: String(params.orderNumber),
            canteenId: params.canteenId,
            title,
            body,
            itemCount: String(params.itemCount),
            totalAmount: String(params.totalAmount),
            slot: params.slot || "",
            timestamp: new Date().toISOString(),
          },
        });

        if (!result.ok) {
          if (result.tokenInvalid) {
            console.warn(`[vendor-push] Invalid/unregistered vendor token detected. Deactivating tokenId=${id} in ${table}`);
            await supabase
              .from(table)
              .update({ is_active: false, updated_at: new Date().toISOString() })
              .eq("id", id);
          } else {
            console.warn("[vendor-push] FCM v1 send error:", result.error);
          }
          throw new Error(result.error);
        }
      })
    );

    const dispatchedCount = results.filter((r) => r.status === "fulfilled").length;
    console.info(`[vendor-push] Successfully dispatched push alert to ${dispatchedCount}/${uniqueTokens.length} devices.`);
    return { success: true, dispatchedCount };
  } catch (err) {
    console.warn("[vendor-push] Error dispatching vendor push notification:", err);
    return { success: false, dispatchedCount: 0 };
  }
}
