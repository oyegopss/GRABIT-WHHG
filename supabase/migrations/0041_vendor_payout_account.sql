-- Migration 0041: Vendor Bank & Payout Account Configuration
-- Canonical columns for public.canteens bank payout processing and Cashfree integration

ALTER TABLE public.canteens
  ADD COLUMN IF NOT EXISTS owner_name TEXT,
  ADD COLUMN IF NOT EXISTS payout_bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS payout_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS payout_beneficiary_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_upi_id TEXT,
  ADD COLUMN IF NOT EXISTS payout_kyc_status TEXT NOT NULL DEFAULT 'NOT_STARTED';

-- Performance index for settlement and payout account lookups
CREATE INDEX IF NOT EXISTS idx_canteens_payout_kyc ON public.canteens(payout_kyc_status);
CREATE INDEX IF NOT EXISTS idx_canteens_payout_bank ON public.canteens(payout_bank_account_number);
