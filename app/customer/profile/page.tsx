"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { GrabItLogo } from "@/components/shared/GrabItLogo";
import { TrackEventOnMount } from "@/components/shared/TrackEventOnMount";
import { ProfileHeader } from "@/components/student/profile/ProfileHeader";
import { EditProfileModal } from "@/components/student/profile/EditProfileModal";
import { SavedAddressesModal } from "@/components/student/profile/SavedAddressesModal";
import { GrabItGoldCard } from "@/components/student/profile/GrabItGoldCard";
import { ProfileMenuItem } from "@/components/student/profile/ProfileMenuItem";
import { CampusSelectorModal } from "@/components/student/CampusSelectorModal";
import {
  getLiveStudentProfile,
  getLiveStudentSubscription,
  updateLiveStudentProfile,
  type StudentProfileDetails,
  type StudentSubscriptionDetails,
} from "@/lib/supabase/student_profile";
import {
  getLiveCampusList,
  type SupabaseCampus,
} from "@/lib/supabase/data";
import {
  getActiveCampusId,
  setActiveCampusId,
  addRecentlyUsedCampusId,
} from "@/lib/campus/campus_storage";
import { createClient } from "@/lib/supabase/client";
import type { GoldPlanId } from "@/lib/payments/gold_plans";
import { unregisterStudentPushToken } from "@/lib/notifications/push_client";

export default function StudentProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<StudentProfileDetails | null>(null);
  const [subscription, setSubscription] = useState<StudentSubscriptionDetails | null>(null);
  const [campuses, setCampuses] = useState<SupabaseCampus[]>([]);
  const [activeCampus, setActiveCampus] = useState<SupabaseCampus | null>(null);
  const [isCampusModalOpen, setIsCampusModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [activeToast, setActiveToast] = useState<string | null>(null);
  const [isGoldProcessing, setIsGoldProcessing] = useState(false);
  const [goldError, setGoldError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [liveProf, liveSub, liveCampuses] = await Promise.all([
      getLiveStudentProfile(),
      getLiveStudentSubscription(),
      getLiveCampusList(),
    ]);

    setCampuses(liveCampuses);

    const savedId = getActiveCampusId();
    const currentCampus = liveCampuses.find((c) => c.id === savedId) || liveCampuses[0] || null;
    setActiveCampus(currentCampus);

    if (liveProf) {
      setProfile(liveProf);
    } else {
      // Default fallback profile structure
      setProfile({
        id: "guest",
        email: "student@grabit.in",
        fullName: "Grabit Customer",
        phone: "+91 98765 43210",
        role: "student",
        campusId: currentCampus?.id || "",
        campusName: currentCampus?.name || "Campus",
        grabitUserId: "GRB-FE1B32",
        avatarUrl:
          "https://lh3.googleusercontent.com/aida-public/AB6AXuDp0UC7dpD4OUKonC4W287WPg0Gnic80gYNaQUlT5JeKVdN9Qi2mZGcvFp3hdZ05VTrWmjRr-Twvu8fFinGwpcdg0gPV1peTnf5OPY7ytoGnVZ1f_q1Op19HPKnEO3X1GvKha2kWOQqpSRkpPyRjGByLCeqU7qcar10tg5xTuhvKY_nuw8tk-fA7oJzUcBXhBRktsp1XTnf94v1SNBiI-7XR0F0i1Y6PtSMwdTnJwHi4QisCMfCh7_R",
      });
    }
    setSubscription(liveSub);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showToast = (message: string) => {
    setActiveToast(message);
    setTimeout(() => {
      setActiveToast(null);
    }, 3000);
  };

  const handleSelectCampus = (campus: SupabaseCampus) => {
    setActiveCampusId(campus.id);
    addRecentlyUsedCampusId(campus.id);
    setActiveCampus(campus);
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            campusId: campus.id,
            campusName: campus.name,
          }
        : prev,
    );
    showToast(`Active campus switched to ${campus.name}`);
  };

  const handleSaveProfile = async (payload: {
    fullName: string;
    phone: string;
    avatarUrl: string;
  }) => {
    const res = await updateLiveStudentProfile(payload);
    if (res.ok) {
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              fullName: payload.fullName,
              phone: payload.phone,
              avatarUrl: payload.avatarUrl,
            }
          : prev,
      );
      showToast("Profile updated successfully.");
    } else {
      showToast(res.error || "We couldn't update your profile. Please try again.");
    }
  };

  const handlePurchaseGoldPlan = async (planId: GoldPlanId) => {
    if (isGoldProcessing) return; // guard against double-clicks
    setGoldError(null);
    setIsGoldProcessing(true);
    try {
      const createRes = await fetch("/api/payments/cashfree/gold-pass/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.ok) {
        setGoldError(createData.error || "Couldn't start your Gold Pass purchase.");
        return;
      }

      const { openCashfreeCheckout } = await import("@/lib/payments/cashfree_client");
      const mode = createData.paymentMode === "PRODUCTION" ? "production" : "sandbox";
      await openCashfreeCheckout(createData.paymentSessionId, mode);

      // Cashfree's modal resolves on close regardless of outcome — the
      // real result only ever comes from the server (webhook already may
      // have landed, or this poll's own reconciliation fallback resolves
      // it). Never trust the checkout promise's resolution as success.
      const finalStatus = await pollGoldPassStatus(createData.cashfreeOrderId);

      if (finalStatus === "PAID") {
        const liveSub = await getLiveStudentSubscription();
        setSubscription(liveSub);
        showToast("GrabIt Gold activated!");
      } else if (finalStatus === "FAILED" || finalStatus === "CANCELLED") {
        setGoldError("Payment didn't go through.");
      } else {
        setGoldError("Still confirming your payment — check back shortly.");
      }
    } catch {
      setGoldError("Couldn't complete checkout. Please try again.");
    } finally {
      setIsGoldProcessing(false);
    }
  };

  const pollGoldPassStatus = async (cashfreeOrderId: string): Promise<string> => {
    const delays = [1500, 2000, 3000, 4000, 5000];
    for (const delay of delays) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const res = await fetch(`/api/payments/cashfree/gold-pass/status?cashfreeOrderId=${encodeURIComponent(cashfreeOrderId)}`);
        const data = await res.json();
        if (data.ok && (data.status === "PAID" || data.status === "FAILED" || data.status === "CANCELLED" || data.status === "EXPIRED")) {
          return data.status;
        }
      } catch {
        // keep polling
      }
    }
    return "PENDING";
  };

  const handleLogout = async () => {
    try {
      await unregisterStudentPushToken();
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // safe fallback
    }
    router.push("/auth");
  };

  const currentGoldSub = subscription
    ? {
        active: subscription.isActive,
        planName: subscription.displayPlanName,
        validUntil: subscription.isActive ? subscription.displayValidUntil : "Inactive",
        perksSummary: subscription.perksSummary,
      }
    : {
        active: false,
        planName: "GrabIt Gold Pass",
        validUntil: "Inactive",
        perksSummary: "Zero platform fees on canteen orders & priority pickup lane access.",
      };

  return (
    <>
      <TrackEventOnMount payload={{ eventName: "gold_plan_viewed" }} />

      {/* Top Bar Header */}
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 sm:h-16 w-full max-w-lg items-center justify-between px-4">
          <GrabItLogo heightClassName="h-8" priority />
          <button
            type="button"
            onClick={() => showToast("Scan QR Code coming soon")}
            className="rounded-full p-2 text-muted transition-transform active:scale-95 hover:text-foreground"
            aria-label="Scan QR Code"
          >
            <span className="material-symbols-outlined text-[24px]" aria-hidden="true">
              qr_code_scanner
            </span>
          </button>
        </div>
      </header>

      {/* Main Profile Content */}
      <main className="mx-auto max-w-lg px-4 pt-6 pb-[calc(7rem+var(--safe-area-inset-bottom,0px))]">
        {isLoading ? (
          <div className="py-16 text-center space-y-4">
            <div className="mx-auto h-24 w-24 rounded-full bg-surface-elevated animate-pulse" />
            <div className="mx-auto h-6 w-48 rounded bg-surface-elevated animate-pulse" />
            <div className="mx-auto h-4 w-32 rounded bg-surface-elevated animate-pulse" />
          </div>
        ) : profile ? (
          <>
            {/* Profile Hero Header */}
            <ProfileHeader
              fullName={profile.fullName}
              grabitUserId={profile.grabitUserId}
              avatarUrl={profile.avatarUrl}
              onEditProfile={() => setIsEditModalOpen(true)}
            />

            {/* GrabIt Gold Subscription Card */}
            <GrabItGoldCard
              subscription={currentGoldSub}
              isProcessing={isGoldProcessing}
              error={goldError}
              onPurchasePlan={(planId: GoldPlanId) => handlePurchaseGoldPlan(planId)}
              onManage={() => showToast("Subscription management panel active.")}
            />

            {/* Campus & Location Card */}
            <div className="mb-4 rounded-3xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-xl flex items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/30">
                  <span className="material-symbols-outlined text-[22px]">school</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted">
                    Active Campus
                  </p>
                  <p className="font-display text-body-sm font-bold text-foreground truncate">
                    {activeCampus?.name || profile.campusName || "Choose Campus"}
                  </p>
                  <p className="text-[11px] text-muted truncate">
                    {activeCampus?.city || "Tap to choose your college"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCampusModalOpen(true)}
                className="rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5 font-display text-caption font-bold text-primary hover:bg-primary hover:text-on-primary active:scale-95 transition-all shrink-0"
              >
                Change Campus
              </button>
            </div>

            {/* Menu Options */}
            <nav aria-label="Profile navigation" className="space-y-3">
              <ProfileMenuItem
                icon="receipt_long"
                title="Order History"
                subtitle="View all your past campus orders"
                href="/customer/orders"
              />
              <ProfileMenuItem
                icon="location_on"
                title="Saved Addresses"
                subtitle="Manage your delivery & pickup spots"
                onClick={() => setIsAddressModalOpen(true)}
              />
              <ProfileMenuItem
                icon="support_agent"
                title="Help & Support"
                subtitle="FAQs, Chat & Contact Support"
                href="/customer/support"
              />
              <ProfileMenuItem
                icon="logout"
                title="Logout"
                subtitle="Switch accounts or exit"
                variant="danger"
                onClick={handleLogout}
              />
            </nav>
          </>
        ) : null}

        {/* Version Footer */}
        <div className="mt-8 text-center">
          <span className="text-caption font-medium opacity-40">
            GrabIt v2.4.0-stealth
          </span>
        </div>
      </main>

      {/* Campus Selector Modal */}
      <CampusSelectorModal
        isOpen={isCampusModalOpen}
        onClose={() => setIsCampusModalOpen(false)}
        campuses={campuses}
        selectedCampusId={activeCampus?.id || null}
        onSelectCampus={handleSelectCampus}
        onDetectLocation={() => {}}
        isDetectingLocation={false}
      />

      {/* Edit Profile Modal */}
      {profile && (
        <EditProfileModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          currentFullName={profile.fullName}
          currentPhone={profile.phone}
          currentEmail={profile.email}
          currentAvatarUrl={profile.avatarUrl}
          grabitUserId={profile.grabitUserId}
          onSave={handleSaveProfile}
        />
      )}

      {/* Saved Addresses Modal */}
      <SavedAddressesModal
        isOpen={isAddressModalOpen}
        onClose={() => setIsAddressModalOpen(false)}
      />

      {/* Toast Notification */}
      {activeToast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full border border-primary/30 bg-surface-elevated px-5 py-2.5 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
          <p className="font-display text-caption font-bold text-primary">{activeToast}</p>
        </div>
      )}
    </>
  );
}
