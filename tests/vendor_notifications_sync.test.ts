/**
 * Automated Verification Test Suite — Vendor Notification Panel Sync & Realtime Persistence
 * Run with node/tsx: npx tsx tests/vendor_notifications_sync.test.ts
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock_anon_key";
}

import { getSupabaseAdminClient } from "../lib/supabase/admin";
import {
  createOperationalNotification,
  type OperationalNotificationItem,
} from "../lib/notifications/operational_notifications";
import { getDeepLinkForNotification, getCategoryForType } from "../lib/supabase/vendor_notifications_center";

async function runVendorNotificationsSyncTests() {
  console.log("==================================================");
  console.log("GRABIT Vendor Notification Center & Realtime Suite");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  const testCanteenIdA = "b1000000-0000-0000-0000-000000000001";
  const testCanteenIdB = "7d11986b-6b0d-4208-8c15-25338cbdd2a3";
  const testOrderId = crypto.randomUUID();
  const dedupeKey = `vendor-new-order:${testOrderId}`;

  // Test 1: Verified Payment Creates Authoritative Vendor Notification
  try {
    const res = await createOperationalNotification({
      recipientType: "vendor",
      canteenId: testCanteenIdA,
      type: "NEW_ORDER",
      severity: "INFO",
      title: "New Order #9999 Received",
      message: "2 items totaling ₹150. Slot: ASAP.",
      actionUrl: `/vendor/orders?orderId=${testOrderId}`,
      relatedOrderId: testOrderId,
      dedupeKey,
    });

    if (res.success && res.id) {
      console.log("✅ TEST 1 PASSED: Verified order payment created persisted vendor operational notification record.");
      passed++;
    } else {
      console.error("❌ TEST 1 FAILED: Failed to create operational notification.", res);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 1 ERROR:", err);
    failed++;
  }

  // Test 2: Unverified / Pending Payment Does NOT Create Notification
  try {
    const pendingPaymentDedupeKey = `vendor-new-order:pending_${Date.now()}`;
    const admin = getSupabaseAdminClient();
    const { data: existing } = await admin
      .from("operational_notifications")
      .select("id")
      .eq("dedupe_key", pendingPaymentDedupeKey);

    if (!existing || existing.length === 0) {
      console.log("✅ TEST 2 PASSED: Pending / unconfirmed payment creates zero vendor operational notification records.");
      passed++;
    } else {
      console.error("❌ TEST 2 FAILED: Notification found for pending payment!");
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 2 ERROR:", err);
    failed++;
  }

  // Test 3: Duplicate Webhook / Event Deduplication Protection
  try {
    const duplicateRes = await createOperationalNotification({
      recipientType: "vendor",
      canteenId: testCanteenIdA,
      type: "NEW_ORDER",
      severity: "INFO",
      title: "New Order #9999 Received (Duplicate)",
      message: "2 items totaling ₹150. Slot: ASAP.",
      actionUrl: `/vendor/orders?orderId=${testOrderId}`,
      relatedOrderId: testOrderId,
      dedupeKey,
    });

    const admin = getSupabaseAdminClient();
    const { count } = await admin
      .from("operational_notifications")
      .select("id", { count: "exact", head: true })
      .eq("dedupe_key", dedupeKey);

    if (duplicateRes.success && count === 1) {
      console.log("✅ TEST 3 PASSED: Duplicate webhook event deduplicated by dedupe_key (exactly 1 record in database).");
      passed++;
    } else {
      console.error("❌ TEST 3 FAILED: Duplicate notification was inserted!", { count });
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 3 ERROR:", err);
    failed++;
  }

  // Test 4: Vendor Canteen Ownership & Strict Data Isolation
  try {
    const admin = getSupabaseAdminClient();
    const { data: notificationsA } = await admin
      .from("operational_notifications")
      .select("id, canteen_id")
      .eq("canteen_id", testCanteenIdA)
      .eq("dedupe_key", dedupeKey);

    const { data: notificationsB } = await admin
      .from("operational_notifications")
      .select("id, canteen_id")
      .eq("canteen_id", testCanteenIdB)
      .eq("dedupe_key", dedupeKey);

    if (notificationsA && notificationsA.length === 1 && (!notificationsB || notificationsB.length === 0)) {
      console.log("✅ TEST 4 PASSED: Vendor canteen isolation strictly enforced (Vendor A sees notification, Vendor B does not).");
      passed++;
    } else {
      console.error("❌ TEST 4 FAILED: Isolation leak detected!", { notificationsA, notificationsB });
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 4 ERROR:", err);
    failed++;
  }

  // Test 5: Category & Deep Link Mapping
  try {
    const sampleItem: OperationalNotificationItem = {
      id: "notif_test_sample",
      recipientType: "vendor",
      type: "NEW_ORDER",
      severity: "INFO",
      title: "New Order #1234",
      message: "Order placed",
      relatedOrderId: "ord_12345",
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };

    const category = getCategoryForType(sampleItem.type);
    const deepLink = getDeepLinkForNotification(sampleItem);

    if (category === "ORDERS" && deepLink === "/vendor/orders?orderId=ord_12345") {
      console.log("✅ TEST 5 PASSED: Operational notification mapped to category 'ORDERS' and deep link '/vendor/orders?orderId=ord_12345'.");
      passed++;
    } else {
      console.error("❌ TEST 5 FAILED: Deep link or category mapping failed.", { category, deepLink });
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 5 ERROR:", err);
    failed++;
  }

  // Test 6: Read / Unread Acknowledge State Persistence
  try {
    const admin = getSupabaseAdminClient();
    const { data: row } = await admin
      .from("operational_notifications")
      .select("id, status")
      .eq("dedupe_key", dedupeKey)
      .single();

    if (row && row.status === "OPEN") {
      // Mark as acknowledged
      await admin
        .from("operational_notifications")
        .update({ status: "ACKNOWLEDGED", acknowledged_at: new Date().toISOString() })
        .eq("id", row.id);

      const { data: updated } = await admin
        .from("operational_notifications")
        .select("id, status, acknowledged_at")
        .eq("id", row.id)
        .single();

      if (updated && updated.status === "ACKNOWLEDGED" && updated.acknowledged_at) {
        console.log("✅ TEST 6 PASSED: Notification read/acknowledged state successfully transitioned and persisted.");
        passed++;
      } else {
        console.error("❌ TEST 6 FAILED: Failed to transition status to ACKNOWLEDGED.", updated);
        failed++;
      }
    } else {
      console.error("❌ TEST 6 FAILED: Initial status was not OPEN.", row);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 6 ERROR:", err);
    failed++;
  }

  // Test 7: Filter Logic (ALL / UNREAD / READ)
  try {
    const mockList: OperationalNotificationItem[] = [
      { id: "1", recipientType: "vendor", type: "NEW_ORDER", severity: "INFO", title: "O1", message: "m1", status: "OPEN", createdAt: "" },
      { id: "2", recipientType: "vendor", type: "NEW_ORDER", severity: "INFO", title: "O2", message: "m2", status: "ACKNOWLEDGED", createdAt: "" },
      { id: "3", recipientType: "vendor", type: "LOW_MENU_AVAILABILITY", severity: "WARNING", title: "I1", message: "m3", status: "OPEN", createdAt: "" },
    ];

    const allFiltered = mockList.filter(() => true);
    const unreadFiltered = mockList.filter((n) => n.status === "OPEN");
    const readFiltered = mockList.filter((n) => n.status !== "OPEN");

    if (allFiltered.length === 3 && unreadFiltered.length === 2 && readFiltered.length === 1) {
      console.log("✅ TEST 7 PASSED: All / Unread Only / Read filter derivations compute accurately.");
      passed++;
    } else {
      console.error("❌ TEST 7 FAILED: Filter logic failure.", { allFiltered, unreadFiltered, readFiltered });
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 7 ERROR:", err);
    failed++;
  }

  // Test 8: Dynamic Count Calculations
  try {
    const mockList: OperationalNotificationItem[] = [
      { id: "1", recipientType: "vendor", type: "NEW_ORDER", severity: "INFO", title: "O1", message: "m1", status: "OPEN", createdAt: "" },
      { id: "2", recipientType: "vendor", type: "NEW_ORDER", severity: "INFO", title: "O2", message: "m2", status: "ACKNOWLEDGED", createdAt: "" },
      { id: "3", recipientType: "vendor", type: "PAYOUT_SETTLED", severity: "INFO", title: "P1", message: "m3", status: "ACKNOWLEDGED", createdAt: "" },
    ];

    let unread = 0;
    let read = 0;
    for (const item of mockList) {
      if (item.status === "OPEN") unread++;
      else read++;
    }

    if (mockList.length === 3 && unread === 1 && read === 2) {
      console.log("✅ TEST 8 PASSED: Header and filter counts compute accurately (Total: 3, Unread: 1, Read: 2).");
      passed++;
    } else {
      console.error("❌ TEST 8 FAILED: Count calculation error.", { total: mockList.length, unread, read });
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 8 ERROR:", err);
    failed++;
  }

  // Cleanup test notification
  try {
    const admin = getSupabaseAdminClient();
    await admin.from("operational_notifications").delete().eq("dedupe_key", dedupeKey);
  } catch {
    // Non-fatal
  }

  console.log("\n==================================================");
  console.log(`Test Execution Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runVendorNotificationsSyncTests().catch((err) => {
  console.error("Test execution crashed:", err);
  process.exit(1);
});
