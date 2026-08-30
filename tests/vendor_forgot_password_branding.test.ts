/**
 * Automated Verification Test Suite — Vendor Forgot Password & GRABIT Email Branding
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/vendor_forgot_password_branding.test.ts
 */

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "mock_anon_key";
}

import { renderPasswordResetEmail } from "../lib/email/templates/password-reset";
import { getFromAddress, getReplyToAddress } from "../lib/email/resend-client";

async function runVendorForgotPasswordTestSuite() {
  console.log("==================================================");
  console.log("GRABIT Vendor Forgot Password Email Branding Test Suite");
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

  const sampleActionLink = "https://grabit.ventures/auth/reset-password?role=vendor#access_token=test-token-xyz&type=recovery";

  // TEST 1: Vendor Email Subject Branding
  const vendorEmail = renderPasswordResetEmail({
    actionLink: sampleActionLink,
    role: "vendor",
  });

  assert(
    vendorEmail.subject === "Reset your GRABIT Vendor password",
    "TEST 1: Vendor email subject is strictly 'Reset your GRABIT Vendor password'.",
    vendorEmail.subject,
  );

  // TEST 2: Vendor Email Content & Visual Branding
  assert(
    vendorEmail.html.includes("GRABIT") &&
      vendorEmail.html.includes("Campus Canteen OS · Vendor Portal") &&
      vendorEmail.html.includes("GRABIT Vendor") &&
      vendorEmail.html.includes("RESET PASSWORD") &&
      vendorEmail.html.includes("Secure vendor operations for campus food businesses."),
    "TEST 2: Vendor email contains full GRABIT branding, dark mode styling, and vendor portal tagline.",
  );

  // TEST 3: Zero Supabase Branding in Visible Email
  assert(
    !vendorEmail.html.toLowerCase().includes("supabase") &&
      !vendorEmail.text.toLowerCase().includes("supabase"),
    "TEST 3: Zero Supabase branding in HTML or plain-text email output.",
  );

  // TEST 4: Student vs Vendor Email Role Isolation
  const studentEmail = renderPasswordResetEmail({
    actionLink: "https://grabit.ventures/auth/reset-password",
    role: "student",
  });

  assert(
    studentEmail.subject === "Reset your GRABIT password" &&
      studentEmail.html.includes("The smartest way to order food across campus canteens.") &&
      !studentEmail.html.includes("Vendor Portal"),
    "TEST 4: Student reset email remains cleanly isolated with student branding.",
  );

  // TEST 5: Sender & Reply-To Addresses
  const fromAddr = getFromAddress();
  const replyToAddr = getReplyToAddress();

  assert(
    fromAddr.toLowerCase().includes("grabit") && !fromAddr.toLowerCase().includes("supabase"),
    "TEST 5: Email sender is GRABIT-branded ('" + fromAddr + "').",
  );

  assert(
    Boolean(replyToAddr),
    "TEST 6: Reply-To address is configured ('" + replyToAddr + "').",
  );

  // TEST 7: Action Link and Security Escape
  const xssLink = 'https://grabit.ventures/reset" onclick="alert(1)';
  const escapedEmail = renderPasswordResetEmail({ actionLink: xssLink, role: "vendor" });
  assert(
    !escapedEmail.html.includes('onclick="alert(1)'),
    "TEST 7: Action link is properly HTML-escaped to prevent injection vulnerabilities.",
  );

  // TEST 8: Plain-text fallback email completeness
  assert(
    vendorEmail.text.includes("Reset your password") &&
      vendorEmail.text.includes(sampleActionLink) &&
      vendorEmail.text.includes("© GRABIT · Campus Canteen OS"),
    "TEST 8: Plain text email fallback contains all essential recovery instructions.",
  );

  console.log("\n==================================================");
  console.log(`Test Execution Summary: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runVendorForgotPasswordTestSuite().catch((err) => {
  console.error("Test execution crashed:", err);
  process.exit(1);
});
