"use client";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { updateUserPassword } from "@/lib/supabase/auth";
import { GrabItLogo } from "@/components/shared/GrabItLogo";
import { createClient } from "@/lib/supabase/client";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = searchParams.get("role");
  const isVendor = role === "vendor";

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLinkExpired, setIsLinkExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    // Check if error description is in URL search params or hash
    const errorDesc = searchParams.get("error_description");
    const errorParam = searchParams.get("error");
    if (
      errorParam ||
      errorDesc?.toLowerCase().includes("expired") ||
      errorDesc?.toLowerCase().includes("invalid")
    ) {
      setIsLinkExpired(true);
      setError(
        errorDesc || "This password reset link is no longer valid or has already been used.",
      );
      setIsCheckingSession(false);
      return;
    }

    if (typeof window !== "undefined" && window.location.hash) {
      const hash = window.location.hash;
      if (hash.includes("error=") || hash.includes("error_description=")) {
        setIsLinkExpired(true);
        setError("This password reset link has expired or is invalid. Please request a new link.");
        setIsCheckingSession(false);
        return;
      }
    }

    // Verify recovery session existence with Supabase
    async function checkSession() {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        // If no session and no hash parameters, user might have navigated directly
        const hasHashAuth =
          typeof window !== "undefined" &&
          (window.location.hash.includes("access_token") ||
            window.location.hash.includes("type=recovery") ||
            window.location.search.includes("code="));

        if (!session && !hasHashAuth) {
          // Wait briefly for Supabase client to parse URL hash if just landing
          setTimeout(async () => {
            const {
              data: { session: retrySession },
            } = await supabase.auth.getSession();
            if (!retrySession) {
              // Not an active recovery session
              setIsLinkExpired(true);
              setError("No active recovery session found. Please request a new password reset link.");
            }
            setIsCheckingSession(false);
          }, 600);
          return;
        }
      } catch {
        // Continue
      } finally {
        setIsCheckingSession(false);
      }
    }

    checkSession();
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match. Please re-enter.");
      return;
    }

    setIsSubmitting(true);
    const res = await updateUserPassword(newPassword);
    setIsSubmitting(false);

    if (!res.ok) {
      const errMsg = res.error || "";
      if (
        errMsg.toLowerCase().includes("expired") ||
        errMsg.toLowerCase().includes("session") ||
        errMsg.toLowerCase().includes("jwt")
      ) {
        setIsLinkExpired(true);
        setError("Your password reset session has expired. Please request a new link.");
      } else {
        setError(errMsg || "Failed to update password. Please try again.");
      }
      return;
    }

    const redirectPath = isVendor ? "/vendor/auth" : "/auth?tab=signin";
    setSuccess(
      `Password updated successfully! Redirecting to ${isVendor ? "Vendor" : ""} Sign In...`,
    );
    setTimeout(() => {
      router.push(redirectPath);
    }, 2000);
  };

  const loginUrl = isVendor ? "/vendor/auth" : "/auth?tab=signin";
  const requestNewLinkUrl = isVendor ? "/vendor/auth" : "/auth?tab=forgot";

  if (isCheckingSession) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
            progress_activity
          </span>
          <p className="font-display text-caption text-muted">Verifying recovery session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      {/* Brand Header */}
      <div className="mb-8 flex flex-col items-center text-center">
        {isVendor ? (
          <Link href="/" className="inline-flex items-center gap-2.5 group">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-black shadow-[0_4px_16px_rgba(255,122,0,0.4)] transition-transform group-hover:scale-105">
              <span className="material-symbols-outlined text-[28px]">storefront</span>
            </span>
            <span className="font-display text-2xl font-black tracking-tight text-white">
              GrabIt <span className="text-primary">Vendor</span>
            </span>
          </Link>
        ) : (
          <GrabItLogo href="/" heightClassName="h-16 sm:h-20" priority />
        )}
        <p className="mt-2 font-body text-body-sm text-muted">
          {isVendor ? "Vendor Store Password Recovery" : "Secure Password Recovery"}
        </p>
      </div>

      {/* Main Card */}
      <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 sm:p-8 shadow-elevated backdrop-blur-xl">
        <h1 className="font-display text-title font-extrabold text-foreground text-center mb-2">
          {isLinkExpired ? "Reset Link Expired" : "Reset Your Password"}
        </h1>
        <p className="font-body text-caption text-faint text-center mb-6">
          {isLinkExpired
            ? "This password reset link is no longer valid or has already been used."
            : isVendor
            ? "Enter your new password below to regain access to your GRABIT Vendor account."
            : "Enter your new password below to regain access to your GrabIt account."}
        </p>

        {error && (
          <div className="mb-4 rounded-xl border border-danger/30 bg-danger-soft p-3 text-center text-caption font-semibold text-danger">
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 rounded-xl border border-success/30 bg-success-soft p-3 text-center text-caption font-semibold text-success">
            {success}
          </div>
        )}

        {isLinkExpired ? (
          <div className="flex flex-col gap-3">
            <Link
              href={requestNewLinkUrl}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-display text-body-sm font-bold uppercase tracking-wider text-on-primary shadow-glow-primary transition-all hover:opacity-90 active:scale-[0.98]"
            >
              Request New Link
            </Link>
            <Link
              href={loginUrl}
              className="flex w-full items-center justify-center rounded-xl border border-border bg-surface-elevated py-3 text-center font-display text-caption font-bold text-muted hover:text-foreground transition-colors"
            >
              Back to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* New Password */}
            <div>
              <label
                htmlFor="newPassword"
                className="mb-1 block font-display text-caption font-bold text-muted"
              >
                New Password
              </label>
              <div className="relative">
                <input
                  id="newPassword"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 text-body-sm text-foreground placeholder:text-faint focus:border-primary focus:outline-none transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
                    {showPassword ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </div>
            </div>

            {/* Confirm New Password */}
            <div>
              <label
                htmlFor="confirmPassword"
                className="mb-1 block font-display text-caption font-bold text-muted"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-xl border border-border bg-surface-elevated px-4 py-3 text-body-sm text-foreground placeholder:text-faint focus:border-primary focus:outline-none transition-colors"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || !!success}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 font-display text-body-sm font-bold uppercase tracking-wider text-on-primary shadow-glow-primary transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-2">
                  <span className="material-symbols-outlined animate-spin text-[18px]">
                    progress_activity
                  </span>
                  Updating Password...
                </span>
              ) : (
                "Update Password"
              )}
            </button>

            {/* Back to Sign In Link */}
            <div className="mt-4 text-center">
              <Link
                href={loginUrl}
                className="font-display text-caption font-bold text-primary hover:underline"
              >
                Back to {isVendor ? "Vendor " : ""}Sign In
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
          <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
            progress_activity
          </span>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
