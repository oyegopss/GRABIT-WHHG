/**
 * Automated Verification Test Suite — Frontend Bundle Secret Scan
 * Run with: npx tsx --env-file=.env.local --conditions=react-server tests/frontend_secret_scan.test.ts
 */

import fs from "node:fs";
import path from "node:path";

async function runFrontendSecretScanTests() {
  console.log("==================================================");
  console.log("GRABIT Frontend Bundle Secret Scan Test Suite");
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

  // TEST 1: Public directory scan for exposed secrets or .env files
  const publicDir = path.join(process.cwd(), "public");
  let exposedInPublic = false;
  if (fs.existsSync(publicDir)) {
    const files = fs.readdirSync(publicDir);
    for (const f of files) {
      if (f.startsWith(".env") || f.endsWith(".key") || f.endsWith(".pem")) {
        exposedInPublic = true;
        console.error("Sensitive file found in public/:", f);
      }
    }
  }
  assert(!exposedInPublic, "TEST 1: Zero environment files or private key files in public/ directory.");

  // TEST 2: Source map generation disabled in next.config.ts for browser
  const nextConfig = fs.readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  assert(
    nextConfig.includes("productionBrowserSourceMaps: false") &&
      nextConfig.includes("poweredByHeader: false"),
    "TEST 2: productionBrowserSourceMaps is disabled and poweredByHeader is false in next.config.ts.",
  );

  // TEST 3: Student and Vendor Capacitor configs point to official production URL with 0 secrets
  const studentCapacitor = fs.readFileSync(path.join(process.cwd(), "capacitor.config.ts"), "utf8");
  const vendorCapacitor = fs.readFileSync(path.join(process.cwd(), "vendor-mobile/capacitor.config.ts"), "utf8");

  assert(
    studentCapacitor.includes("https://grabit.ventures") &&
      vendorCapacitor.includes("https://grabit.ventures") &&
      !studentCapacitor.includes("cfsk_") &&
      !vendorCapacitor.includes("cfsk_"),
    "TEST 3: Capacitor mobile configs use https://grabit.ventures with zero embedded private keys.",
  );

  console.log("\n==================================================");
  console.log(`Frontend Secret Scan: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================\n");

  if (failed > 0) process.exit(1);
}

runFrontendSecretScanTests().catch((err) => {
  console.error("Frontend secret scan test suite crashed:", err);
  process.exit(1);
});
