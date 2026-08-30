"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function VendorResetPasswordRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("role", "vendor");
    router.replace(`/auth/reset-password?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-3">
        <span className="material-symbols-outlined animate-spin text-[32px] text-primary">
          progress_activity
        </span>
        <p className="font-display text-caption text-muted">Opening Vendor Password Reset…</p>
      </div>
    </div>
  );
}

export default function VendorResetPasswordPage() {
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
      <VendorResetPasswordRedirect />
    </Suspense>
  );
}
