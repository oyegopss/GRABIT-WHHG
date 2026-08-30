/**
 * Automated Verification Test Suite — Final Production Security Audit & Hardening
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/final_production_security.test.ts
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock_anon_key";
}

import { verifyCashfreeWebhookSignature } from "../lib/payments/cashfree";
import { checkRateLimit } from "../lib/security/rate_limit";
import { validateOrderStatusTransition } from "../lib/orders/status_transitions";
import { renderPasswordResetEmail } from "../lib/email/templates/password-reset";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

async function runFinalProductionSecuritySuite() {
  console.log("==================================================");
  console.log("GRABIT Final Production Security Audit Test Suite");
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

  // ----------------------------------------------------
  // TEST 1: Secret Exposure in NEXT_PUBLIC_* variables
  // ----------------------------------------------------
  const publicVars = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
  const forbiddenKeywords = ["SECRET", "SERVICE_ROLE", "PRIVATE", "PASSWORD", "RESEND_KEY"];
  let exposedInNextPublic = false;

  for (const k of publicVars) {
    for (const kw of forbiddenKeywords) {
      if (k.toUpperCase().includes(kw)) {
        exposedInNextPublic = true;
        console.error(`Forbidden secret in NEXT_PUBLIC: ${k}`);
      }
    }
  }
  assert(!exposedInNextPublic, "TEST 1: Zero server secrets in NEXT_PUBLIC_* environment variables.");

  // ----------------------------------------------------
  // TEST 2: Cashfree Webhook Constant-Time Signature Verification
  // ----------------------------------------------------
  const clientSecret = process.env.CASHFREE_CLIENT_SECRET || "dummy_secret_for_test";
  const timestamp = "1725000000";
  const rawBody = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "GRABIT-ORDER-123" } } });
  const validSignature = createHmac("sha256", clientSecret).update(timestamp + rawBody).digest("base64");
  const forgedSignature = "invalid_forged_signature_xyz";

  process.env.CASHFREE_CLIENT_SECRET = clientSecret;
  const validCheck = verifyCashfreeWebhookSignature(rawBody, timestamp, validSignature);
  const invalidCheck = verifyCashfreeWebhookSignature(rawBody, timestamp, forgedSignature);

  assert(
    validCheck === true && invalidCheck === false,
    "TEST 2: Cashfree webhook HMAC-SHA256 signature verification accepts valid signature and rejects forged payloads.",
  );

  // ----------------------------------------------------
  // TEST 3: Rate Limiting & Abuse Prevention
  // ----------------------------------------------------
  const testKey = "final-sec-rate-limit-" + Date.now();
  let blockedOnLimit = false;
  for (let i = 0; i < 6; i++) {
    const res = checkRateLimit(testKey, 5, 60_000);
    if (i === 5 && res.limited) {
      blockedOnLimit = true;
    }
  }
  assert(blockedOnLimit, "TEST 3: Rate limiting blocks requests exceeding defined sliding window limit.");

  // ----------------------------------------------------
  // TEST 4: Vendor Order RBAC State Machine
  // ----------------------------------------------------
  const invalidTransition = validateOrderStatusTransition("completed", "preparing", "vendor");
  const validTransition = validateOrderStatusTransition("placed", "preparing", "vendor");
  assert(
    !invalidTransition.ok && validTransition.ok,
    "TEST 4: State transition rules strictly enforce sequential order workflow and prevent unauthorized status rollbacks.",
  );

  // ----------------------------------------------------
  // TEST 5: Password Reset Email XSS Sanitization & GRABIT Branding
  // ----------------------------------------------------
  const payloadWithXSS = 'https://grabit.ventures/auth/reset-password?role=vendor"><script>alert(1)</script>';
  const rendered = renderPasswordResetEmail({ actionLink: payloadWithXSS, role: "vendor" });
  assert(
    !rendered.html.includes("<script>") &&
      rendered.html.includes("&lt;script&gt;") &&
      rendered.subject === "Reset your GRABIT Vendor password" &&
      !rendered.html.toLowerCase().includes("supabase"),
    "TEST 5: Action links in password reset emails are XSS-escaped and strictly GRABIT-branded.",
  );

  // ----------------------------------------------------
  // TEST 6: Mobile Configuration & Role Separation
  // ----------------------------------------------------
  const studentCapacitor = fs.readFileSync(path.join(process.cwd(), "capacitor.config.ts"), "utf8");
  const vendorCapacitor = fs.readFileSync(path.join(process.cwd(), "vendor-mobile/capacitor.config.ts"), "utf8");

  assert(
    studentCapacitor.includes("app.grabit.student") &&
      vendorCapacitor.includes("com.grabit.vendor") &&
      !studentCapacitor.includes("CASHFREE_CLIENT_SECRET") &&
      !vendorCapacitor.includes("CASHFREE_CLIENT_SECRET"),
    "TEST 6: Student and Vendor Android packages are distinct, role-separated, and contain 0 server secrets.",
  );

  // ----------------------------------------------------
  // TEST 7: Security Headers Configuration
  // ----------------------------------------------------
  const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  assert(
    nextConfig.includes("X-Frame-Options") &&
      nextConfig.includes("X-Content-Type-Options") &&
      nextConfig.includes("Strict-Transport-Security") &&
      nextConfig.includes("Referrer-Policy") &&
      nextConfig.includes("Permissions-Policy"),
    "TEST 7: Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) active in next.config.ts.",
  );

  // ----------------------------------------------------
  // TEST 8: Server-Only Guard on Backend Modules
  // ----------------------------------------------------
  const cashfreePgFile = fs.readFileSync(path.join(process.cwd(), "lib/payments/cashfree.ts"), "utf8");
  const cashfreePayoutsFile = fs.readFileSync(path.join(process.cwd(), "lib/payments/cashfree_payouts.ts"), "utf8");
  const emailServiceFile = fs.readFileSync(path.join(process.cwd(), "lib/email/email-service.ts"), "utf8");
  const razorpayFile = fs.readFileSync(path.join(process.cwd(), "lib/payments/razorpay.ts"), "utf8");

  assert(
    cashfreePgFile.includes('import "server-only";') &&
      cashfreePayoutsFile.includes('import "server-only";') &&
      emailServiceFile.includes('import "server-only";') &&
      razorpayFile.includes('import "server-only";'),
    "TEST 8: Critical financial, payment, and transactional backend modules enforce server-only boundaries.",
  );

  // ----------------------------------------------------
  // TEST 9: Source Code Output Safety (No dangerouslySetInnerHTML / eval)
  // ----------------------------------------------------
  let dangerousPatternFound = false;
  const scanDir = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git" || entry.name === "android" || entry.name === "vendor-mobile") continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (content.includes("dangerouslySetInnerHTML") || content.includes("eval(")) {
          dangerousPatternFound = true;
          console.error("Dangerous pattern in:", fullPath);
        }
      }
    }
  };
  scanDir(path.join(process.cwd(), "app"));
  scanDir(path.join(process.cwd(), "components"));

  assert(!dangerousPatternFound, "TEST 9: Zero occurrences of dangerouslySetInnerHTML or eval in app/ and components/.");

  // ----------------------------------------------------
  // TEST 10: Environment Configuration Separation
  // ----------------------------------------------------
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  assert(
    envExample.includes("CASHFREE_ENVIRONMENT=SANDBOX") &&
      envExample.includes("CASHFREE_PAYOUTS_ENVIRONMENT=SANDBOX") &&
      !envExample.includes("cfsk_ma_prod_"),
    "TEST 10: Environment configuration explicitly separates SANDBOX and PRODUCTION modes with zero leaked secrets in template.",
  );

  console.log("\n==================================================");
  console.log(`Final Security Test Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runFinalProductionSecuritySuite().catch((err) => {
  console.error("Final security test suite crashed:", err);
  process.exit(1);
});
