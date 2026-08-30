"use client";

import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import type { SupabaseCampus } from "@/lib/supabase/data";

interface CampusSwitchCartModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCampus: SupabaseCampus | null;
  currentCampusName: string;
  cartItemCount: number;
  onConfirmSwitchAndClearCart: () => void;
}

export function CampusSwitchCartModal({
  isOpen,
  onClose,
  targetCampus,
  currentCampusName,
  cartItemCount,
  onConfirmSwitchAndClearCart,
}: CampusSwitchCartModalProps) {
  useBodyScrollLock(isOpen);

  if (!isOpen || !targetCampus) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/85 backdrop-blur-md transition-all p-4 pb-[max(2rem,calc(env(safe-area-inset-bottom,0px)+1.5rem))] sm:items-center sm:p-4">
      <div className="w-full max-w-sm flex flex-col rounded-3xl border border-warning/40 bg-surface p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Warning Icon & Title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-warning/15 text-warning border border-warning/30">
            <span className="material-symbols-outlined text-[24px]">shopping_cart_checkout</span>
          </div>
          <div>
            <h3 className="font-display text-body-lg font-extrabold text-foreground">
              Switch Campus?
            </h3>
            <p className="font-body text-caption text-muted">
              Cart conflict detected
            </p>
          </div>
        </div>

        {/* Message */}
        <div className="rounded-2xl border border-border-subtle bg-surface-elevated p-3.5 mb-4 text-caption text-muted space-y-1.5">
          <p className="text-foreground font-medium">
            You currently have <span className="text-primary font-bold">{cartItemCount} item{cartItemCount > 1 ? "s" : ""}</span> in your cart from <span className="text-foreground font-bold">{currentCampusName}</span>.
          </p>
          <p>
            Switching to <span className="text-primary font-bold">{targetCampus.name}</span> will clear your current cart because items cannot be mixed across campuses.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onConfirmSwitchAndClearCart();
              onClose();
            }}
            className="w-full rounded-xl bg-danger py-2.5 font-display text-caption font-bold uppercase tracking-wider text-white transition-all hover:opacity-90 active:scale-[0.98] shadow-sm flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">remove_shopping_cart</span>
            Switch & Clear Cart
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-border bg-surface-elevated py-2.5 font-display text-caption font-bold text-muted hover:text-foreground active:scale-[0.98] transition-all"
          >
            Keep Current Campus
          </button>
        </div>
      </div>
    </div>
  );
}
