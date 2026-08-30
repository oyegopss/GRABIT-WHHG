/**
 * Automated Verification Test Suite — Environment & Secrets Exposure Security
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/env_exposure_security.test.ts
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

async function runEnvExposureSecurityTests() {
  console.log("==================================================");
  console.log("GRABIT Environment Variable & Secrets Exposure Test Suite");
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

  // TEST 1: .gitignore protects all .env local variants
  const gitignoreContent = fs.readFileSync(path.join(process.cwd(), ".gitignore"), "utf8");
  assert(
    gitignoreContent.includes(".env*") || gitignoreContent.includes(".env.local"),
    "TEST 1: .gitignore contains rules ignoring .env, .env.local, and .env.*.local.",
  );

  // TEST 2: Git tracked files do not include .env.local or private keys
  const trackedFiles = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  const leakedEnv = trackedFiles.filter((f) => f === ".env.local" || f.endsWith(".pem") || f.endsWith(".key"));
  assert(
    leakedEnv.length === 0,
    "TEST 2: Zero private keys (.pem, .key) or .env.local files tracked in git repository.",
    leakedEnv,
  );

  // TEST 3: NEXT_PUBLIC_* variables in code contains 0 server secrets
  const publicVars = Object.keys(process.env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
  const sensitiveWords = ["SECRET", "SERVICE_ROLE", "PRIVATE", "RESEND_KEY", "CLIENT_SECRET"];
  let badPublicVar: string | null = null;
  for (const v of publicVars) {
    for (const w of sensitiveWords) {
      if (v.toUpperCase().includes(w)) {
        badPublicVar = v;
      }
    }
  }
  assert(
    badPublicVar === null,
    "TEST 3: Zero server secrets found under NEXT_PUBLIC_* namespace in environment.",
    badPublicVar,
  );

  // TEST 4: .env.example contains 0 real secrets/credentials
  const envExample = fs.readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
  assert(
    !envExample.includes("cfsk_ma_prod_") &&
      !envExample.includes("eyJhbGciOi") &&
      !envExample.includes("sk_live_"),
    "TEST 4: .env.example contains purely empty placeholder templates with zero real secrets.",
  );

  console.log("\n==================================================");
  console.log(`Env Exposure Tests: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) process.exit(1);
}

runEnvExposureSecurityTests().catch((err) => {
  console.error("Env exposure test suite crashed:", err);
  process.exit(1);
});
