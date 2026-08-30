import { NextResponse } from "next/server";

/**
 * Server-side sliding-window rate limiter for API endpoints.
 * Provides risk-categorized rate limits, sliding window tracking,
 * and standard HTTP 429 response formatting with Retry-After and X-RateLimit headers.
 * 
 * Note: Under serverless distributed execution, instances enforce local in-memory
 * sliding windows. For enterprise multi-region fleets, a centralized Redis/Upstash
 * store can be swapped in without modifying caller interfaces.
 */

interface BucketEntry {
  timestamps: number[];
  lastCleanup: number;
}

const buckets = new Map<string, BucketEntry>();

// Periodic bucket garbage collection to prevent memory expansion
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export interface RateLimitResult {
  limited: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
}

export interface RateLimitTier {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_TIERS = {
  // Authentication & credential operations (strict)
  AUTH: { limit: 10, windowMs: 15 * 60 * 1000 },
  PASSWORD_RESET: { limit: 5, windowMs: 15 * 60 * 1000 },

  // Financial & payment endpoints
  PAYMENT: { limit: 15, windowMs: 10 * 60 * 1000 },
  PAYOUT: { limit: 5, windowMs: 10 * 60 * 1000 },

  // Student orders & state transitions
  ORDER: { limit: 30, windowMs: 60 * 1000 },

  // Super Admin operations
  ADMIN: { limit: 60, windowMs: 60 * 1000 },

  // Public discovery & menu queries
  PUBLIC: { limit: 120, windowMs: 60 * 1000 },
} as const;

/**
 * Checks and updates rate limit for a specific key.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry) {
    entry = { timestamps: [], lastCleanup: now };
    buckets.set(key, entry);
  }

  // Filter timestamps within current sliding window
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);
  entry.timestamps.push(now);

  const count = entry.timestamps.length;
  const limited = count > limit;
  const remaining = Math.max(0, limit - count);

  // Oldest timestamp in current window determines reset
  const oldest = entry.timestamps[0] ?? now;
  const resetMs = Math.max(0, windowMs - (now - oldest));
  const resetSeconds = Math.ceil(resetMs / 1000);
  const retryAfterSeconds = Math.max(1, resetSeconds);

  // Routine cleanup of stale keys
  if (now - entry.lastCleanup > CLEANUP_INTERVAL_MS) {
    entry.lastCleanup = now;
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets.entries()) {
        b.timestamps = b.timestamps.filter((t) => now - t < windowMs);
        if (b.timestamps.length === 0) {
          buckets.delete(k);
        }
      }
    }
  }

  return {
    limited,
    limit,
    remaining,
    resetSeconds,
    retryAfterSeconds,
  };
}

/**
 * Constructs a standardized HTTP 429 response with appropriate headers.
 */
export function createRateLimitResponse(
  result: RateLimitResult,
  customMessage?: string,
): NextResponse {
  const message =
    customMessage ||
    `Too many requests. Please wait ${result.retryAfterSeconds} seconds before trying again.`;

  return NextResponse.json(
    {
      ok: false,
      error: message,
      retryAfter: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "Retry-After": result.retryAfterSeconds.toString(),
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": result.resetSeconds.toString(),
      },
    },
  );
}

/**
 * Extracts client IP prioritizing trusted infrastructure headers.
 */
export function getClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  if (cfConnectingIp) return cfConnectingIp.trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";

  return "unknown";
}
