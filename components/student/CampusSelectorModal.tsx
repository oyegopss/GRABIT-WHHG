"use client";

import { useState, useMemo, useEffect } from "react";
import type { SupabaseCampus } from "@/lib/supabase/data";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { getRecentlyUsedCampusIds } from "@/lib/campus/campus_storage";

interface NearbyCampusItem {
  campus: SupabaseCampus;
  distanceMeters: number;
}

interface CampusSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  campuses: SupabaseCampus[];
  selectedCampusId: string | null;
  onSelectCampus: (campus: SupabaseCampus) => void;
  onDetectLocation: () => void;
  isDetectingLocation: boolean;
  locationStatusMessage?: string;
  /** Suggestion from GPS detection — never switches silently without explicit user confirmation */
  pendingConfirmCampus?: { campus: SupabaseCampus; distanceMeters: number } | null;
  /** Multiple nearby campuses detected by GPS */
  allNearbyCampuses?: NearbyCampusItem[] | null;
  onConfirmDetectedCampus?: (campus?: SupabaseCampus) => void;
  onDismissConfirm?: () => void;
  /** Current cart item count to warn if switching will clear cart */
  cartItemCount?: number;
  currentCampusName?: string;
  onAttemptSwitchWithCart?: (targetCampus: SupabaseCampus) => void;
}

export function CampusSelectorModal({
  isOpen,
  onClose,
  campuses,
  selectedCampusId,
  onSelectCampus,
  onDetectLocation,
  isDetectingLocation,
  locationStatusMessage,
  pendingConfirmCampus,
  allNearbyCampuses,
  onConfirmDetectedCampus,
  onDismissConfirm,
  cartItemCount = 0,
  currentCampusName = "Campus",
  onAttemptSwitchWithCart,
}: CampusSelectorModalProps) {
  const [search, setSearch] = useState("");
  const [recentCampusIds, setRecentCampusIds] = useState<string[]>([]);

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      setRecentCampusIds(getRecentlyUsedCampusIds());
    }
  }, [isOpen, selectedCampusId]);

  const filteredCampuses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return campuses;
    return campuses.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        (c.short_name && c.short_name.toLowerCase().includes(q)) ||
        (c.address && c.address.toLowerCase().includes(q)),
    );
  }, [campuses, search]);

  const recentlyUsedCampuses = useMemo(() => {
    if (search.trim().length > 0) return [];
    return recentCampusIds
      .map((id) => campuses.find((c) => c.id === id))
      .filter((c): c is SupabaseCampus => Boolean(c));
  }, [recentCampusIds, campuses, search]);

  const otherSupportedCampuses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q) {
      return campuses.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q) ||
          (c.short_name && c.short_name.toLowerCase().includes(q)) ||
          (c.address && c.address.toLowerCase().includes(q)),
      );
    }
    const recentSet = new Set(recentCampusIds);
    return campuses.filter((c) => !recentSet.has(c.id));
  }, [campuses, search, recentCampusIds]);

  if (!isOpen) return null;

  const handleCampusClick = (campus: SupabaseCampus) => {
    // If it's already the active campus, just close
    if (campus.id === selectedCampusId) {
      onClose();
      return;
    }

    // If student has items in cart from another campus, show cart confirmation
    if (cartItemCount > 0 && onAttemptSwitchWithCart) {
      onAttemptSwitchWithCart(campus);
      return;
    }

    onSelectCampus(campus);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/80 backdrop-blur-md transition-all p-3 pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.5rem))] sm:items-center sm:p-4 sm:pb-4">
      <div className="w-full max-w-md max-h-[82dvh] flex flex-col rounded-3xl border border-border bg-surface p-4 sm:p-5 shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between gap-2 shrink-0">
          <div>
            <h3 className="font-display text-body-lg sm:text-heading font-extrabold text-foreground tracking-tight">
              Choose Your Campus
            </h3>
            <p className="font-body text-caption text-muted">
              Select your college to discover open canteens & food stalls
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-full p-1.5 text-muted hover:bg-surface-elevated hover:text-foreground transition-colors shrink-0"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        {/* GPS Auto Detect Button */}
        <button
          type="button"
          onClick={onDetectLocation}
          disabled={isDetectingLocation}
          className="mb-3 flex w-full shrink-0 items-center justify-between rounded-2xl border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-left font-display text-body-sm font-bold text-primary transition-all hover:bg-primary/20 active:scale-[0.99] disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2.5">
            <span
              className={`material-symbols-outlined text-[20px] ${
                isDetectingLocation ? "animate-spin text-primary" : "text-primary"
              }`}
              aria-hidden="true"
            >
              {isDetectingLocation ? "progress_activity" : "my_location"}
            </span>
            <span className="leading-tight">
              {isDetectingLocation ? "Detecting your campus…" : "Auto-Detect Campus via GPS"}
            </span>
          </div>
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            chevron_right
          </span>
        </button>

        {/* Multiple Nearby Campuses Suggestion Banner */}
        {allNearbyCampuses && allNearbyCampuses.length > 1 && (
          <div className="mb-3 shrink-0 rounded-2xl border border-primary/40 bg-primary/10 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="font-display text-caption font-bold text-foreground flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">near_me</span>
                Multiple campuses nearby
              </p>
              <button
                type="button"
                onClick={onDismissConfirm}
                className="text-[11px] font-bold text-muted hover:text-foreground cursor-pointer"
              >
                Dismiss
              </button>
            </div>
            <div className="space-y-1.5">
              {allNearbyCampuses.map((item) => (
                <div
                  key={item.campus.id}
                  className="flex items-center justify-between rounded-xl bg-surface/80 p-2 border border-border-subtle"
                >
                  <div className="min-w-0 pr-2">
                    <p className="font-display text-caption font-bold text-foreground truncate">
                      {item.campus.name}
                    </p>
                    <p className="text-[10px] text-primary font-semibold">
                      {item.distanceMeters < 1000
                        ? `${item.distanceMeters}m away`
                        : `${(item.distanceMeters / 1000).toFixed(1)} km away`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (onConfirmDetectedCampus) {
                        onConfirmDetectedCampus(item.campus);
                      } else {
                        handleCampusClick(item.campus);
                      }
                    }}
                    className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold uppercase text-on-primary hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Single Nearby Campus Confirmation Banner (Medium confidence 1-5km) */}
        {pendingConfirmCampus && (!allNearbyCampuses || allNearbyCampuses.length <= 1) && (
          <div className="mb-3 shrink-0 rounded-2xl border border-primary/40 bg-primary/10 p-3.5 animate-in fade-in">
            <div className="flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[20px] text-primary shrink-0 mt-0.5">
                location_searching
              </span>
              <div className="flex-1">
                <p className="font-display text-body-sm font-bold text-foreground">
                  You seem to be near {pendingConfirmCampus.campus.name}
                </p>
                <p className="mt-0.5 text-caption text-muted">
                  About{" "}
                  {pendingConfirmCampus.distanceMeters < 1000
                    ? `${pendingConfirmCampus.distanceMeters}m`
                    : `${(pendingConfirmCampus.distanceMeters / 1000).toFixed(1)} km`}{" "}
                  away. Switch to this campus?
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (onConfirmDetectedCampus) {
                        onConfirmDetectedCampus(pendingConfirmCampus.campus);
                      } else {
                        handleCampusClick(pendingConfirmCampus.campus);
                      }
                    }}
                    className="flex-1 rounded-xl bg-primary py-2 font-display text-caption font-extrabold uppercase tracking-wider text-on-primary transition-all hover:opacity-90 active:scale-95 cursor-pointer"
                  >
                    Switch to This Campus
                  </button>
                  <button
                    type="button"
                    onClick={onDismissConfirm}
                    className="rounded-xl border border-border px-3.5 py-2 font-display text-caption font-bold text-muted hover:text-foreground cursor-pointer"
                  >
                    Keep Current
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Location Status Alert */}
        {locationStatusMessage && (
          <div className="mb-3 shrink-0 rounded-xl border border-warning/30 bg-warning/10 p-2.5 text-caption font-medium text-warning flex items-center justify-center gap-2 text-center">
            <span className="material-symbols-outlined text-[16px] shrink-0">location_off</span>
            <span>{locationStatusMessage}</span>
          </div>
        )}

        {/* Search Campus Input */}
        <div className="relative mb-3 shrink-0">
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted text-[18px]"
            aria-hidden="true"
          >
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search college name, city or alias..."
            className="w-full rounded-2xl border border-border bg-surface-elevated py-2.5 pl-9 pr-3 text-caption text-foreground outline-none transition-colors placeholder:text-muted focus:border-primary"
          />
        </div>

        {/* Scrollable Campus List */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-0.5 pb-2">
          {/* Recently Used Section */}
          {recentlyUsedCampuses.length > 0 && !search.trim() && (
            <div className="space-y-2">
              <p className="font-display text-[11px] font-bold uppercase tracking-wider text-muted px-1">
                Recently Used
              </p>
              <div className="space-y-2">
                {recentlyUsedCampuses.map((cmp) => {
                  const isSelected = cmp.id === selectedCampusId;
                  return (
                    <button
                      key={`recent-${cmp.id}`}
                      type="button"
                      onClick={() => handleCampusClick(cmp)}
                      className={`flex w-full items-center justify-between rounded-2xl p-3 text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-2 border-primary bg-primary/10 text-primary shadow-sm"
                          : "border border-border-subtle bg-surface-elevated text-foreground hover:border-muted hover:bg-border/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={`material-symbols-outlined text-[20px] shrink-0 ${
                            isSelected ? "text-primary" : "text-muted"
                          }`}
                          aria-hidden="true"
                        >
                          history
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-display text-body-sm font-bold text-foreground truncate">
                              {cmp.name}
                            </p>
                            {cmp.short_name && (
                              <span className="rounded bg-surface px-1.5 py-0.5 font-display text-[9px] font-extrabold uppercase text-primary border border-border-subtle shrink-0">
                                {cmp.short_name}
                              </span>
                            )}
                            {isSelected && (
                              <span className="rounded-full bg-primary/20 text-primary px-2 py-0.5 text-[9px] font-extrabold uppercase border border-primary/30 shrink-0">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="font-body text-[11px] text-muted">{cmp.city}</p>
                        </div>
                      </div>

                      {isSelected && (
                        <span
                          className="material-symbols-outlined text-[20px] text-primary shrink-0 ml-2"
                          aria-hidden="true"
                        >
                          check_circle
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* All / Filtered Campuses Section */}
          <div className="space-y-2">
            <p className="font-display text-[11px] font-bold uppercase tracking-wider text-muted px-1">
              {search.trim()
                ? "Search Results"
                : recentlyUsedCampuses.length > 0
                ? "Other Supported Campuses"
                : "All Supported Campuses"}
            </p>
            {otherSupportedCampuses.length === 0 ? (
              <div className="py-8 text-center text-caption text-muted">
                {search.trim()
                  ? `No campuses match "${search}".`
                  : "All available campuses are in your recently used list above."}
              </div>
            ) : (
              <div className="space-y-2">
                {otherSupportedCampuses.map((cmp) => {
                  const isSelected = cmp.id === selectedCampusId;
                  return (
                    <button
                      key={cmp.id}
                      type="button"
                      onClick={() => handleCampusClick(cmp)}
                      className={`flex w-full items-center justify-between rounded-2xl p-3 text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-2 border-primary bg-primary/10 text-primary shadow-sm"
                          : "border border-border-subtle bg-surface-elevated text-foreground hover:border-muted hover:bg-border/30"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className={`material-symbols-outlined text-[20px] shrink-0 ${
                            isSelected ? "text-primary" : "text-muted"
                          }`}
                          aria-hidden="true"
                        >
                          location_city
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-display text-body-sm font-bold text-foreground truncate">
                              {cmp.name}
                            </p>
                            {cmp.short_name && (
                              <span className="rounded bg-surface px-1.5 py-0.5 font-display text-[9px] font-extrabold uppercase text-primary border border-border-subtle shrink-0">
                                {cmp.short_name}
                              </span>
                            )}
                            {isSelected && (
                              <span className="rounded-full bg-primary/20 text-primary px-2 py-0.5 text-[9px] font-extrabold uppercase border border-primary/30 shrink-0">
                                Current
                              </span>
                            )}
                          </div>
                          <p className="font-body text-[11px] text-muted">{cmp.city}</p>
                        </div>
                      </div>

                      {isSelected && (
                        <span
                          className="material-symbols-outlined text-[20px] text-primary shrink-0 ml-2"
                          aria-hidden="true"
                        >
                          check_circle
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
