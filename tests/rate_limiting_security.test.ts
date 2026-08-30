/**
 * Automated Verification Test Suite — Rate Limiting Security
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/rate_limiting_security.test.ts
 */

import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  RATE_LIMIT_TIERS,
} from "../lib/security/rate_limit";

async function runRateLimitingSecurityTests() {
  console.log("==================================================");
  console.log("GRABIT Rate Limiting Security Test Suite");
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

  // TEST 1: Password reset rate limiting throttles after 5 attempts
  const testKeyReset = `test-reset-limit-${Date.now()}`;
  for (let i = 0; i < RATE_LIMIT_TIERS.PASSWORD_RESET.limit; i++) {
    const res = checkRateLimit(testKeyReset, RATE_LIMIT_TIERS.PASSWORD_RESET.limit, RATE_LIMIT_TIERS.PASSWORD_RESET.windowMs);
    if (i === RATE_LIMIT_TIERS.PASSWORD_RESET.limit - 1) {
      assert(!res.limited && res.remaining === 0, "TEST 1A: 5th attempt reaches 0 remaining quota without being limited.");
    }
  }

  const sixthAttempt = checkRateLimit(testKeyReset, RATE_LIMIT_TIERS.PASSWORD_RESET.limit, RATE_LIMIT_TIERS.PASSWORD_RESET.windowMs);
  assert(sixthAttempt.limited === true, "TEST 1B: 6th attempt is blocked (limited: true).");

  // TEST 2: Rate limit response returns standard 429 status and headers
  const response429 = createRateLimitResponse(sixthAttempt);
  assert(
    response429.status === 429 &&
      response429.headers.has("Retry-After") &&
      response429.headers.has("X-RateLimit-Limit") &&
      response429.headers.has("X-RateLimit-Remaining") &&
      response429.headers.has("X-RateLimit-Reset"),
    "TEST 2: HTTP 429 response includes Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers.",
  );

  // TEST 3: Payout rate limiter is strict (5 attempts per window)
  const testKeyPayout = `test-payout-limit-${Date.now()}`;
  for (let i = 0; i < RATE_LIMIT_TIERS.PAYOUT.limit; i++) {
    checkRateLimit(testKeyPayout, RATE_LIMIT_TIERS.PAYOUT.limit, RATE_LIMIT_TIERS.PAYOUT.windowMs);
  }
  const payoutBlock = checkRateLimit(testKeyPayout, RATE_LIMIT_TIERS.PAYOUT.limit, RATE_LIMIT_TIERS.PAYOUT.windowMs);
  assert(payoutBlock.limited === true, "TEST 3: Payout endpoint enforces strict limit (blocked on 6th request).");

  // TEST 4: Client IP extraction hierarchy
  const dummyReq1 = new Request("https://grabit.ventures", {
    headers: { "cf-connecting-ip": "203.0.113.195", "x-forwarded-for": "198.51.100.1" },
  });
  const dummyReq2 = new Request("https://grabit.ventures", {
    headers: { "x-real-ip": "198.51.100.2", "x-forwarded-for": "198.51.100.3, 198.51.100.4" },
  });

  assert(
    getClientIp(dummyReq1) === "203.0.113.195" && getClientIp(dummyReq2) === "198.51.100.2",
    "TEST 4: Client IP resolution prioritizes trusted infrastructure headers (CF-Connecting-IP / X-Real-IP).",
  );

  console.log("\n==================================================");
  console.log(`Rate Limiting Tests: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) process.exit(1);
}

runRateLimitingSecurityTests().catch((err) => {
  console.error("Rate limiting test suite crashed:", err);
  process.exit(1);
});
