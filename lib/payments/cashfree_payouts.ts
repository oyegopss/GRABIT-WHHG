/**
 * Server-only Cashfree PAYOUTS client — completely separate from
 * lib/payments/cashfree.ts (Payment Gateway) and
 * lib/payments/cashfree_client.ts (browser-side PG checkout loader).
 *
 * Architecture:
 * - Payment Gateway receives student order money.
 * - Cashfree Payouts transfers daily settlement money to vendors.
 * - GRABIT Financial Ledger remains the source of truth for internal accounting.
 * - Cashfree Payouts is the external money execution provider.
 *
 * Current official Cashfree Payouts specification:
 * - Sandbox: https://payout-gamma.cashfree.com/payout
 * - Production: https://payout-api.cashfree.com/payout
 */

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

if (typeof window !== "undefined") {
  throw new Error("FATAL: lib/payments/cashfree_payouts is a server-only module and cannot be imported in client components or browser JavaScript.");
}

export type PayoutsEnvironment = "SANDBOX" | "PRODUCTION";

const SANDBOX_BASE_URL = "https://payout-gamma.cashfree.com/payout";
const PRODUCTION_BASE_URL = "https://payout-api.cashfree.com/payout";

export function isCashfreePayoutsConfigured(): boolean {
  return Boolean(process.env.CASHFREE_PAYOUTS_CLIENT_ID && process.env.CASHFREE_PAYOUTS_CLIENT_SECRET);
}

export function getPayoutsConfig() {
  const clientId = process.env.CASHFREE_PAYOUTS_CLIENT_ID?.trim();
  const clientSecret = process.env.CASHFREE_PAYOUTS_CLIENT_SECRET?.trim();
  const environment = (process.env.CASHFREE_PAYOUTS_ENVIRONMENT?.trim().toUpperCase() as PayoutsEnvironment) || "SANDBOX";

  if (!clientId || !clientSecret) {
    throw new Error("CASHFREE_PAYOUTS_NOT_CONFIGURED");
  }

  const baseUrl = environment === "PRODUCTION" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
  return { clientId, clientSecret, environment, baseUrl };
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/**
 * Obtains an active Cashfree Bearer token via POST /v1/authorize.
 * Uses cached token until 30 seconds before expiration.
 */
export async function getAuthToken(): Promise<string> {
  const { clientId, clientSecret, baseUrl } = getPayoutsConfig();

  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }

  const res = await fetch(`${baseUrl}/v1/authorize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": clientId,
      "X-Client-Secret": clientSecret,
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || body?.status !== "SUCCESS" || !body?.data?.token) {
    const errorMsg = body?.message || `Cashfree Payouts auth failed (HTTP ${res.status})`;
    throw new Error(errorMsg);
  }

  // Token is valid for ~10 minutes, cache for 9 minutes
  const expiryMs = body.data.expiry ? Number(body.data.expiry) * 1000 : Date.now() + 9 * 60_000;
  cachedToken = {
    token: body.data.token,
    expiresAt: Math.min(expiryMs, Date.now() + 9 * 60_000),
  };

  return cachedToken.token;
}

/**
 * Authenticated fetch helper for Cashfree Payouts endpoints.
 */
export async function payoutsFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl } = getPayoutsConfig();
  const token = await getAuthToken();

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok || body?.status === "ERROR") {
    const msg = body?.message || `Cashfree Payouts API error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return body;
}

export interface PayoutsBalance {
  availableBalance: number;
  fundSource: string | null;
}

/**
 * Fetches real available balance from Cashfree's own fund source.
 * Never derived from internal ledger.
 */
export async function getPayoutsBalance(): Promise<PayoutsBalance> {
  const body = await payoutsFetch("/v1/getBalance", { method: "GET" });
  return {
    availableBalance: Number(body?.data?.availableBalance ?? 0),
    fundSource: body?.data?.fundSource ?? null,
  };
}

export interface AddBeneficiaryParams {
  beneficiaryId: string;
  name: string;
  email?: string;
  phone: string;
  bankAccount?: string;
  ifsc?: string;
  vpa?: string;
  address1?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

/**
 * Registers or updates a vendor beneficiary in Cashfree Payouts.
 */
export async function addBeneficiary(params: AddBeneficiaryParams) {
  return payoutsFetch("/v1/addBeneficiary", {
    method: "POST",
    body: JSON.stringify({
      beneId: params.beneficiaryId,
      name: params.name,
      email: params.email || "vendor@grabit.ventures",
      phone: params.phone,
      bankAccount: params.bankAccount,
      ifsc: params.ifsc,
      vpa: params.vpa,
      address1: params.address1 || "Campus Canteen",
      city: params.city || "Kanpur",
      state: params.state || "Uttar Pradesh",
      pincode: params.pincode || "208001",
    }),
  });
}

/**
 * Fetches details for a registered Cashfree beneficiary.
 */
export async function getBeneficiaryStatus(beneficiaryId: string) {
  return payoutsFetch(`/v1/getBeneficiary/${encodeURIComponent(beneficiaryId)}`, { method: "GET" });
}

export interface RequestTransferParams {
  transferId: string; // GRABIT-side idempotency reference: GRABIT-PAYOUT-{uuid}
  beneficiaryId: string;
  amount: number;
  remarks?: string;
}

export interface TransferResult {
  referenceId: string;
  status: "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED" | "REVERSED";
  utr?: string;
  rawStatus?: string;
}

/**
 * Initiates the actual money transfer through Cashfree Payouts.
 * Strictly idempotent based on transferId.
 */
export async function requestTransfer(params: RequestTransferParams): Promise<TransferResult> {
  const config = getPayoutsConfig();
  const v2BaseUrl =
    config.environment === "PRODUCTION"
      ? "https://api.cashfree.com/payout"
      : "https://sandbox.cashfree.com/payout";

  const res = await fetch(`${v2BaseUrl}/transfers`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": "2024-01-01",
    },
    body: JSON.stringify({
      transfer_id: params.transferId,
      transfer_amount: Number(params.amount),
      transfer_currency: "INR",
      transfer_mode: "banktransfer",
      beneficiary_details: {
        beneficiary_id: params.beneficiaryId,
      },
      transfer_remarks: (params.remarks || `GRABIT Payout ${params.transferId.slice(0, 12)}`).slice(0, 30),
    }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok && res.status !== 409) {
    const msg = body?.message || `Cashfree Payouts API error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const rawStatus = body?.status || body?.status_code || "PENDING";
  let status: TransferResult["status"] = "PENDING";

  if (rawStatus === "SUCCESS") status = "SUCCESS";
  else if (rawStatus === "FAILED" || rawStatus === "REJECTED") status = "FAILED";
  else if (rawStatus === "REVERSED") status = "REVERSED";
  else status = "PROCESSING";

  return {
    referenceId: String(body?.cf_transfer_id || body?.transfer_id || params.transferId),
    status,
    utr: body?.utr,
    rawStatus,
  };
}

/**
 * Fetches current transfer status from Cashfree by transferId.
 */
export async function getTransferStatus(transferId: string): Promise<TransferResult> {
  const config = getPayoutsConfig();
  const v2BaseUrl =
    config.environment === "PRODUCTION"
      ? "https://api.cashfree.com/payout"
      : "https://sandbox.cashfree.com/payout";

  const res = await fetch(`${v2BaseUrl}/transfers?transfer_id=${encodeURIComponent(transferId)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": config.clientId,
      "x-client-secret": config.clientSecret,
      "x-api-version": "2024-01-01",
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = body?.message || `Cashfree Payouts API error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const rawStatus = body?.status || body?.status_code || "PENDING";
  let status: TransferResult["status"] = "PENDING";

  if (rawStatus === "SUCCESS") status = "SUCCESS";
  else if (rawStatus === "FAILED" || rawStatus === "REJECTED") status = "FAILED";
  else if (rawStatus === "REVERSED") status = "REVERSED";
  else status = "PROCESSING";

  return {
    referenceId: String(body?.cf_transfer_id || body?.transfer_id || transferId),
    status,
    utr: body?.utr,
    rawStatus,
  };
}

/**
 * Verifies the HMAC-SHA256 signature on Cashfree Payouts webhooks.
 * Cashfree computes HMAC-SHA256 of `timestamp + rawBody` with the Payouts client secret.
 */
export function verifyCashfreePayoutWebhookSignature(rawBody: string, timestamp: string, signature: string): boolean {
  try {
    const clientSecret = process.env.CASHFREE_PAYOUTS_CLIENT_SECRET?.trim();
    if (!clientSecret || !signature || !timestamp) return false;

    const expected = createHmac("sha256", clientSecret)
      .update(timestamp + rawBody)
      .digest("base64");

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);

    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Safe connection diagnostics for Super Admin dashboard.
 * Returns connection status and whitelisting diagnostics without leaking secrets.
 */
export async function checkCashfreePayoutsConnection() {
  if (!isCashfreePayoutsConfigured()) {
    return {
      configured: false,
      connected: false,
      connectionStatus: "NOT_CONFIGURED" as const,
      message: "Cashfree Payouts environment credentials are not configured.",
    };
  }

  try {
    const balance = await getPayoutsBalance();
    return {
      configured: true,
      connected: true,
      connectionStatus: "CONNECTED" as const,
      availableBalance: balance.availableBalance,
      fundSource: balance.fundSource,
      syncedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const isIpError = msg.toLowerCase().includes("ip not whitelisted");
    const ipMatch = msg.match(/ip is ([0-9.]+)/i);

    return {
      configured: true,
      connected: false,
      connectionStatus: "ERROR" as const,
      error: isIpError
        ? `Cashfree Sandbox requires IP whitelisting. Detected server IP: ${ipMatch ? ipMatch[1] : "Current Public IP"}. Whitelist this IP in Cashfree Dashboard -> Payouts -> Settings.`
        : msg,
      detectedIp: ipMatch ? ipMatch[1] : null,
      isIpWhitelistingRequired: isIpError,
      syncedAt: new Date().toISOString(),
    };
  }
}
