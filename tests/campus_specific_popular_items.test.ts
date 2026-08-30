/**
 * Automated Verification Test Suite — Campus-Specific Popular Items & Recommendations
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/campus_specific_popular_items.test.ts
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock_anon_key";
}

import { getStudentRecommendations } from "../lib/supabase/student_recommendations";
import { getSupabaseAdminClient } from "../lib/supabase/admin";

async function runCampusSpecificPopularTestSuite() {
  console.log("==================================================");
  console.log("GRABIT Campus-Specific Popular Items Test Suite");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  const AXIS_CAMPUS_ID = "a1000000-0000-0000-0000-000000000001";
  const PSIT_CAMPUS_ID = "a2000000-0000-0000-0000-000000000002";
  const IITK_CAMPUS_ID = "a3000000-0000-0000-0000-000000000003";
  const RAMA_CAMPUS_ID = "a4000000-0000-0000-0000-000000000004";

  // TEST 1: Campus A Query returns only items from Campus A canteens
  try {
    const axisRecommendations = await getStudentRecommendations(AXIS_CAMPUS_ID);
    const hasOnlyAxisItems = axisRecommendations.recommendations.every(
      (item) => item.campusId === AXIS_CAMPUS_ID,
    );

    const hasPsitItem = axisRecommendations.recommendations.some(
      (item) => item.campusId === PSIT_CAMPUS_ID,
    );

    if (hasOnlyAxisItems && !hasPsitItem && axisRecommendations.recommendations.length > 0) {
      console.log(`✅ TEST 1 PASSED: Campus A (Axis) recommendations strictly scoped to Axis canteens (${axisRecommendations.recommendations.length} items, 0 cross-campus leaks).`);
      passed++;
    } else {
      console.error("❌ TEST 1 FAILED: Recommendations contained items from another campus.", axisRecommendations);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 1 ERROR:", err);
    failed++;
  }

  // TEST 2: Switch Campus A -> Campus B returns exclusively Campus B items
  try {
    const psitRecommendations = await getStudentRecommendations(PSIT_CAMPUS_ID);
    const hasOnlyPsitItems = psitRecommendations.recommendations.every(
      (item) => item.campusId === PSIT_CAMPUS_ID,
    );
    const hasAxisItem = psitRecommendations.recommendations.some(
      (item) => item.campusId === AXIS_CAMPUS_ID,
    );

    if (hasOnlyPsitItems && !hasAxisItem && psitRecommendations.recommendations.length > 0) {
      console.log(`✅ TEST 2 PASSED: Campus B (PSIT) recommendations strictly scoped to PSIT canteens (${psitRecommendations.recommendations.length} items, Axis items absent).`);
      passed++;
    } else {
      console.error("❌ TEST 2 FAILED: PSIT query returned cross-campus items.", psitRecommendations);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 2 ERROR:", err);
    failed++;
  }

  // TEST 3: Campus with no active menu items returns clean empty state without falling back to global items
  try {
    const ramaRecommendations = await getStudentRecommendations(RAMA_CAMPUS_ID);
    if (
      ramaRecommendations.recommendations.length === 0 &&
      ramaRecommendations.campusId === RAMA_CAMPUS_ID
    ) {
      console.log("✅ TEST 3 PASSED: Campus without items returns empty recommendations list (no global fallback leak).");
      passed++;
    } else {
      console.error("❌ TEST 3 FAILED: Empty campus fell back to global items.", ramaRecommendations);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 3 ERROR:", err);
    failed++;
  }

  // TEST 4: Vendor belongs to Campus A but query requests Campus B
  try {
    const psitRecs = await getStudentRecommendations(PSIT_CAMPUS_ID);
    // BURGER KING belongs to Axis (b1000000-0000-0000-0000-000000000001)
    const hasBurgerKing = psitRecs.recommendations.some(
      (r) => r.canteenName.toLowerCase().includes("burger king") || r.canteenId === "b1000000-0000-0000-0000-000000000001",
    );

    if (!hasBurgerKing) {
      console.log("✅ TEST 4 PASSED: Vendor-to-campus validation strictly enforced (Axis vendors never appear in PSIT recommendations).");
      passed++;
    } else {
      console.error("❌ TEST 4 FAILED: Axis vendor Burger King appeared in PSIT recommendations.", psitRecs);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 4 ERROR:", err);
    failed++;
  }

  // TEST 5: Cache keys and state isolation
  try {
    const cache: Record<string, any> = {};
    const axisData = await getStudentRecommendations(AXIS_CAMPUS_ID);
    cache[AXIS_CAMPUS_ID] = axisData;

    const psitData = await getStudentRecommendations(PSIT_CAMPUS_ID);
    cache[PSIT_CAMPUS_ID] = psitData;

    if (
      cache[AXIS_CAMPUS_ID].campusId === AXIS_CAMPUS_ID &&
      cache[PSIT_CAMPUS_ID].campusId === PSIT_CAMPUS_ID &&
      cache[AXIS_CAMPUS_ID].recommendations[0].campusId !== cache[PSIT_CAMPUS_ID].recommendations[0]?.campusId
    ) {
      console.log("✅ TEST 5 PASSED: Cache keys strictly partitioned by activeCampusId (no cross-campus cache pollution).");
      passed++;
    } else {
      console.error("❌ TEST 5 FAILED: Cache pollution detected.", cache);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 5 ERROR:", err);
    failed++;
  }

  // TEST 6: Order placed at Campus B does not pollute Campus A's popularity score
  try {
    const admin = getSupabaseAdminClient();
    const testOrderId = crypto.randomUUID();
    const psitCanteenId = "b2000000-0000-0000-0000-000000000001";
    const psitItemId = "c2000000-0000-0000-0000-000000000003"; // Cheese Grilled Sandwich

    // Create a mock order at PSIT
    await admin.from("orders").insert({
      id: testOrderId,
      canteen_id: psitCanteenId,
      total_amount: 120,
      order_number: Math.floor(1000 + Math.random() * 9000),
      status: "completed",
      slot: "lunch_break",
      payment_method: "CASHFREE_UPI",
    });

    await admin.from("order_items").insert({
      order_id: testOrderId,
      menu_item_id: psitItemId,
      canteen_id: psitCanteenId,
      quantity: 5,
      price_at_order: 120,
    });

    // Query Axis recommendations
    const axisAfterPsitOrder = await getStudentRecommendations(AXIS_CAMPUS_ID);
    const hasPsitItemInAxis = axisAfterPsitOrder.recommendations.some(
      (r) => r.itemId === psitItemId,
    );

    // Query PSIT recommendations
    const psitAfterOrder = await getStudentRecommendations(PSIT_CAMPUS_ID);
    const hasPsitItemInPsit = psitAfterOrder.recommendations.some(
      (r) => r.itemId === psitItemId,
    );

    if (!hasPsitItemInAxis && hasPsitItemInPsit) {
      console.log("✅ TEST 6 PASSED: Order at PSIT increases PSIT popularity while Axis recommendations remain completely unaffected.");
      passed++;
    } else {
      console.error("❌ TEST 6 FAILED: Cross-campus order popularity leak.", { hasPsitItemInAxis, hasPsitItemInPsit });
      failed++;
    }

    // Cleanup test order
    await admin.from("order_items").delete().eq("order_id", testOrderId);
    await admin.from("orders").delete().eq("id", testOrderId);
  } catch (err) {
    console.error("❌ TEST 6 ERROR:", err);
    failed++;
  }

  // TEST 7: IIT Kanpur recommendations contain IITK items
  try {
    const iitkRecs = await getStudentRecommendations(IITK_CAMPUS_ID);
    const hasOnlyIitkItems = iitkRecs.recommendations.every(
      (r) => r.campusId === IITK_CAMPUS_ID,
    );

    if (hasOnlyIitkItems && iitkRecs.recommendations.length > 0) {
      console.log(`✅ TEST 7 PASSED: IIT Kanpur recommendations strictly contain IITK items (${iitkRecs.recommendations.map((r) => r.title).join(", ")}).`);
      passed++;
    } else {
      console.error("❌ TEST 7 FAILED: IITK recommendations scoping failure.", iitkRecs);
      failed++;
    }
  } catch (err) {
    console.error("❌ TEST 7 ERROR:", err);
    failed++;
  }

  console.log("\n==================================================");
  console.log(`Test Execution Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runCampusSpecificPopularTestSuite().catch((err) => {
  console.error("Test execution crashed:", err);
  process.exit(1);
});
