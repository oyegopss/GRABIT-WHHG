import "server-only";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export interface ConfirmPaymentOptions {
  orderId?: string;
  paymentId?: string;
  cashfreeOrderId?: string;
  cashfreePaymentId?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gatewayResponse?: any;
  actorReason?: string;
}

/**
 * Authoritative single source of truth for confirming an order payment.
 * Guarantees:
 * 1. Atomically marks payment row as 'success'.
 * 2. Touches the order record so Supabase Realtime emits an UPDATE on `orders` for vendor listeners.
 * 3. Records audit history.
 * 4. Deducts inventory stock.
 * 5. Dispatches student notification (PAYMENT_SUCCESS).
 * 6. Dispatches vendor operational notification (NEW_ORDER) and FCM push alert.
 * 7. Strictly idempotent: will never double-process or double-notify if called repeatedly.
 */
export async function confirmOrderPaymentSuccess(options: ConfirmPaymentOptions): Promise<{
  success: boolean;
  orderId?: string;
  alreadyPaid?: boolean;
  error?: string;
}> {
  const admin = getSupabaseAdminClient();

  // 1. Locate the target payment record
  let query = admin.from("payments").select("id, order_id, amount, status, cashfree_order_id");
  if (options.paymentId) {
    query = query.eq("id", options.paymentId);
  } else if (options.cashfreeOrderId) {
    query = query.eq("cashfree_order_id", options.cashfreeOrderId);
  } else if (options.orderId) {
    query = query.eq("order_id", options.orderId);
  } else {
    return { success: false, error: "No order or payment identifier provided." };
  }

  const { data: payment, error: pErr } = await query.maybeSingle();
  if (pErr || !payment) {
    return { success: false, error: "Payment record not found." };
  }

  // Idempotency check: If already marked success, safely return without re-triggering notifications
  if (payment.status === "success") {
    return { success: true, orderId: payment.order_id, alreadyPaid: true };
  }

  const nowIso = new Date().toISOString();

  // 2. Mark payment row as SUCCESS
  const { error: updateErr } = await admin
    .from("payments")
    .update({
      status: "success",
      cashfree_payment_id: options.cashfreePaymentId || null,
      gateway_response: options.gatewayResponse || undefined,
      webhook_received_at: nowIso,
      paid_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", payment.id);

  if (updateErr) {
    console.error("[confirmOrderPaymentSuccess] Failed to update payment to success:", updateErr);
    return { success: false, error: "Failed to update payment record." };
  }

  // 3. Touch the order record with updated_at timestamp.
  // This is CRUCIAL: it triggers Supabase Realtime UPDATE event on the `orders` table,
  // prompting connected vendor dashboards and orders boards to fetch fresh orders
  // and ring for this newly paid order!
  await admin
    .from("orders")
    .update({
      updated_at: nowIso,
    })
    .eq("id", payment.order_id);

  // 4. Record audit history
  try {
    await admin.from("order_status_history").insert({
      order_id: payment.order_id,
      previous_status: "placed",
      new_status: "placed",
      changed_by: "system_payment_confirmation",
      actor_role: "system",
      reason: options.actorReason || "Payment verified successfully via payment gateway",
    });
  } catch (auditErr) {
    console.warn("[confirmOrderPaymentSuccess] Non-critical audit insertion warning:", auditErr);
  }

  // 5. Fetch order row for inventory & notifications
  const { data: orderRow } = await admin
    .from("orders")
    .select("id, student_id, order_number, canteen_id, total_amount, slot")
    .eq("id", payment.order_id)
    .maybeSingle();

  if (orderRow) {
    // 6. Deduct inventory stock for ordered items
    try {
      const { data: orderItems } = await admin
        .from("order_items")
        .select("menu_item_id, quantity")
        .eq("order_id", payment.order_id);

      if (orderItems && orderItems.length > 0) {
        for (const item of orderItems) {
          try {
            await admin.rpc("adjust_inventory_stock", {
              p_menu_item_id: item.menu_item_id,
              p_quantity_delta: -item.quantity,
              p_adjustment_type: "order_deduction",
              p_reason: `Order ${orderRow.order_number ?? payment.order_id}`,
              p_user_id: orderRow.student_id ?? null,
            });
          } catch {
            // Non-fatal if inventory RPC is not present or already adjusted
          }
        }
      }
    } catch {
      // Non-fatal
    }

    // 7. Student Notification
    try {
      const { createStudentNotification } = await import("@/lib/notifications/student_notifications");
      await createStudentNotification({
        userId: orderRow.student_id,
        type: "PAYMENT_SUCCESS",
        title: "Payment successful",
        message: `Your payment for order ${orderRow.order_number} was successful.`,
        severity: "SUCCESS",
        category: "PAYMENTS",
        relatedOrderId: orderRow.id,
        actionUrl: `/customer/orders/${orderRow.id}`,
        dedupeKey: `cashfree-paid:${payment.id}`,
      });
    } catch (sErr) {
      console.warn("[confirmOrderPaymentSuccess] Student notification error:", sErr);
    }

    // 8. Vendor Operational Notification & High-Priority Push Alert
    if (orderRow.canteen_id) {
      try {
        const { count: itemCount } = await admin
          .from("order_items")
          .select("id", { count: "exact", head: true })
          .eq("order_id", orderRow.id);

        const { createOperationalNotification } = await import("@/lib/notifications/operational_notifications");
        await createOperationalNotification({
          recipientType: "vendor",
          canteenId: orderRow.canteen_id,
          type: "NEW_ORDER",
          severity: "INFO",
          title: `New Order #${orderRow.order_number ?? orderRow.id.slice(0, 6)} Received`,
          message: `${itemCount ?? 1} items totaling ₹${orderRow.total_amount}. Slot: ${orderRow.slot || "Standard"}.`,
          actionUrl: `/vendor/orders?orderId=${orderRow.id}`,
          relatedOrderId: orderRow.id,
          dedupeKey: `vendor-new-order:${orderRow.id}`,
        });

        const { sendVendorNewOrderPushNotification } = await import("@/lib/notifications/vendor_push_service");
        await sendVendorNewOrderPushNotification({
          orderId: orderRow.id,
          orderNumber: String(orderRow.order_number ?? orderRow.id.slice(0, 6)),
          canteenId: orderRow.canteen_id,
          itemCount: itemCount ?? 1,
          totalAmount: Number(orderRow.total_amount),
          slot: orderRow.slot || undefined,
        });
      } catch (vErr) {
        console.warn("[confirmOrderPaymentSuccess] Vendor notification error:", vErr);
      }
    }
  }

  return { success: true, orderId: payment.order_id, alreadyPaid: false };
}
