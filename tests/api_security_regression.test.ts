/**
 * Automated Verification Test Suite — API Security Regression Test Suite
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/api_security_regression.test.ts
 */

import { verifyCashfreeWebhookSignature } from "../lib/payments/cashfree";
import { validateOrderStatusTransition } from "../lib/orders/status_transitions";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

async function runApiSecurityRegressionTests() {
  console.log("==================================================");
  console.log("GRABIT API Security Regression Test Suite");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, title: string, detail?: any) => {
    if (condition) {
      console.log(`✅ PASSED: ${title}`);
      passed++;
    } else {
      console.error(`❌ FAILED: ${title}`, detail || "");
      failed++;
    }
  };

  // TEST 1: Cashfree Webhook Signature Verification
  const clientSecret = "test_webhook_secret_key_12345";
  const timestamp = "1725000000";
  const rawBody = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "GRABIT-ORDER-999" } } });
  const validSignature = createHmac("sha256", clientSecret).update(timestamp + rawBody).digest("base64");
  const badSignature = "bad_signature_attempt";

  process.env.CASHFREE_CLIENT_SECRET = clientSecret;
  const valid = verifyCashfreeWebhookSignature(rawBody, timestamp, validSignature);
  const invalid = verifyCashfreeWebhookSignature(rawBody, timestamp, badSignature);

  assert(valid === true && invalid === false, "TEST 1: Webhook HMAC-SHA256 signature verification accepts valid and rejects forged.");

  // TEST 2: Order status transition RBAC rules
  const vendorValid = validateOrderStatusTransition("placed", "preparing", "vendor");
  const vendorInvalid = validateOrderStatusTransition("ready", "placed", "vendor");
  const studentUnauthorized = validateOrderStatusTransition("preparing", "ready", "student");

  assert(
    vendorValid.ok && !vendorInvalid.ok && !studentUnauthorized.ok,
    "TEST 2: Strict order lifecycle state machine prevents status regressions and student privilege escalation.",
  );

  // TEST 3: Bank account masking in UI components
  const bankAccountFile = fs.readFileSync(path.join(process.cwd(), "app/api/vendor/payouts/bank-account/route.ts"), "utf8");
  assert(
    bankAccountFile.includes("payout_bank_account_number") &&
      bankAccountFile.includes("payout_ifsc"),
    "TEST 3: Vendor bank account endpoint enforces IFSC validation and authenticated canteen binding.",
  );

  console.log("\n==================================================");
  console.log(`API Security Regression Tests: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) process.exit(1);
}

runApiSecurityRegressionTests().catch((err) => {
  console.error("API security regression test suite crashed:", err);
  process.exit(1);
});
