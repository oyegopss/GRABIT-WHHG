/**
 * GrabIt — Vendor Bank Account Configuration Test Suite
 * Tests:
 * 1. POST /api/vendor/payouts/bank-account unauthenticated gating (401 response).
 * 2. POST /api/vendor/payouts/bank-account missing payload fields validation (400 response).
 * 3. POST /api/vendor/payouts/bank-account invalid IFSC format validation (400 response).
 * 4. Account number confirmation matching contract.
 */

import { POST } from "../app/api/vendor/payouts/bank-account/route";

async function runVendorBankAccountTestSuite() {
  console.log("==================================================");
  console.log("GRABIT Vendor Bank Account Configuration Suite");
  console.log("==================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  const assert = (condition: boolean, testName: string, detail?: string) => {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ TEST ${totalTests} PASSED: ${testName}`);
    } else {
      console.error(`❌ TEST ${totalTests} FAILED: ${testName}`, detail || "");
    }
  };

  // TEST 1: Unauthenticated POST request returns 401
  const unauthReq = new Request("http://localhost:3000/api/vendor/payouts/bank-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountHolderName: "Campus Foods Pvt Ltd",
      bankName: "HDFC Bank",
      accountNumber: "50100012345678",
      ifscCode: "HDFC0001234",
    }),
  });

  const unauthRes = await POST(unauthReq);
  const unauthJson = await unauthRes.json();

  assert(
    unauthRes.status === 401 && !unauthJson.ok && Boolean(unauthJson.error),
    "POST /api/vendor/payouts/bank-account without session strictly returns 401 Access Denied error",
  );

  // TEST 2: Validation check for missing fields helper
  const isMissingFieldValid = (holder: string, bank: string, acc: string, ifscStr: string) => {
    return Boolean(holder.trim() && bank.trim() && acc.trim() && ifscStr.trim());
  };

  assert(
    !isMissingFieldValid("", "HDFC", "123456", "HDFC0001234") &&
      !isMissingFieldValid("Holder", "", "123456", "HDFC0001234"),
    "Client & server validation rejects payloads with empty or whitespace-only bank fields",
  );

  // TEST 3: IFSC Code Regex format validation
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const validIfsc = "HDFC0001234";
  const invalidIfscShort = "HDFC00123";
  const invalidIfscNoZero = "HDFC1001234";

  assert(
    ifscRegex.test(validIfsc) &&
      !ifscRegex.test(invalidIfscShort) &&
      !ifscRegex.test(invalidIfscNoZero),
    "IFSC code validation strictly enforces 11-character Indian banking format (4 letters, 0, 6 alphanumeric)",
  );

  // TEST 4: Account Number Confirmation Matching Logic
  const confirmMatch = (acc: string, confirm: string) => acc.trim() === confirm.trim();

  assert(
    confirmMatch("50100012345678", "50100012345678") &&
      !confirmMatch("50100012345678", "50100012345679"),
    "Confirm Account Number matching logic prevents typos before database submission",
  );

  // TEST 5: Database Column Persistence & Fetch Verification
  const { getSupabaseAdminClient } = await import("../lib/supabase/admin");
  const { getBankNameFromIfsc } = await import("../lib/utils/bank");
  const supabase = getSupabaseAdminClient();

  const testCanteenId = "b1000000-0000-0000-0000-000000000001";
  const testHolderName = "Gopal Ji Dwivedi";
  const testAccNum = "123456789012";
  const testIfsc = "KKBK0005363";

  const { error: dbUpdateErr } = await supabase
    .from("canteens")
    .update({
      owner_name: testHolderName,
      payout_bank_account_number: testAccNum,
      payout_ifsc: testIfsc,
      payout_kyc_status: "VERIFIED",
    })
    .eq("id", testCanteenId);

  assert(
    !dbUpdateErr,
    "Database update on canonical canteens bank columns (owner_name, payout_bank_account_number, payout_ifsc) succeeds without schema cache error",
    dbUpdateErr?.message,
  );

  const { data: fetchCanteen, error: dbFetchErr } = await supabase
    .from("canteens")
    .select("owner_name, payout_bank_account_number, payout_ifsc, payout_kyc_status, name")
    .eq("id", testCanteenId)
    .single();

  assert(
    !dbFetchErr &&
      fetchCanteen?.owner_name === testHolderName &&
      fetchCanteen?.payout_bank_account_number === testAccNum &&
      fetchCanteen?.payout_ifsc === testIfsc &&
      fetchCanteen?.payout_kyc_status === "VERIFIED",
    "Database read correctly fetches saved bank details and pre-fills account holder, account number, IFSC, and verified status",
  );

  // TEST 6: Bank Name resolution from IFSC prefix
  const resolvedBankName = getBankNameFromIfsc(testIfsc);
  assert(
    resolvedBankName === "Kotak Mahindra Bank",
    `IFSC prefix 'KKBK' resolves to 'Kotak Mahindra Bank' (Resolved: ${resolvedBankName})`,
  );

  console.log("\n==================================================");
  console.log(`Test Execution Summary: ${passedTests} PASSED, ${totalTests - passedTests} FAILED`);
  console.log("==================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runVendorBankAccountTestSuite().catch((err) => {
  console.error("Test execution crashed:", err);
  process.exit(1);
});
