# GRABIT — Production Email Security & DNS Authentication Guide

This document defines the production domain email authentication configuration for **grabit.ventures** using **Resend**.

---

## 1. Overview & Architecture

- **Primary Sending Domain**: `grabit.ventures`
- **Mail Service Provider**: Resend (`resend.com`)
- **Sender Address**: `GRABIT <noreply@grabit.ventures>`
- **Support / Reply-To**: `support.grabit@gmail.com`
- **Security Boundary**: All email dispatches occur server-side through `lib/email/email-service.ts` guarded by `import "server-only";`. `RESEND_API_KEY` is strictly isolated to backend execution and is never exposed to browser bundles or Android APKs.

---

## 2. DNS Authentication Records (grabit.ventures)

To guarantee high inbox deliverability and protect against domain spoofing/phishing, configure the following DNS records in the domain registrar / DNS provider for `grabit.ventures`:

### A. DKIM (DomainKeys Identified Mail)
- **Status**: `MANUAL ACTION REQUIRED`
- **Type**: `TXT`
- **Name**: `resend._domainkey` (or the specific selector provided in Resend Dashboard)
- **Value**: Copied directly from *Resend Dashboard → Domains → grabit.ventures*
- **Purpose**: Cryptographically verifies that outgoing emails claiming to be from `grabit.ventures` were genuinely sent by GRABIT and have not been modified in transit.

### B. SPF (Sender Policy Framework)
- **Status**: `MANUAL ACTION REQUIRED`
- **Type**: `TXT`
- **Name**: `@` (Root domain `grabit.ventures`)
- **Value**: `"v=spf1 include:amazonses.com ~all"`
  *(Note: If Google Workspace or other mail providers also send from this domain, combine them: `"v=spf1 include:_spf.google.com include:amazonses.com ~all"`. Do NOT publish multiple SPF records on `@`.)*
- **Purpose**: Authorizes Resend's sending mail servers to send emails on behalf of `grabit.ventures`.

### C. DMARC (Domain-based Message Authentication, Reporting & Conformance)
- **Status**: `MANUAL ACTION REQUIRED`
- **Type**: `TXT`
- **Name**: `_dmarc`
- **Value**: `"v=DMARC1; p=none; rua=mailto:dmarc-reports@grabit.ventures; pct=100; sp=none; aspf=r;"`
- **Purpose**: Defines domain policy and delivers aggregate reports on mail authentication failures. Once DKIM and SPF alignment are established and verified, upgrade policy to `p=quarantine` or `p=reject`.

### D. MX / Bounce Subdomain (Optional / Recommended by Resend)
- **Status**: `MANUAL ACTION REQUIRED`
- **Type**: `MX`
- **Name**: `bounces.grabit.ventures` (or `resend.grabit.ventures`)
- **Priority**: `10`
- **Value**: `feedback-smtp.us-east-1.amazonses.com`

---

## 3. Verification Steps

1. In **Resend Dashboard** (`resend.com`):
   - Navigate to **Domains** → Add `grabit.ventures`.
   - Copy the exact DKIM, SPF, and MX record names and values.
2. In your **DNS Provider** (GoDaddy / Namecheap / Cloudflare):
   - Add the TXT and MX records exactly as specified.
   - Save changes and allow 5–30 minutes for DNS propagation.
3. In **Resend Dashboard**:
   - Click **Verify Domain**.
   - Confirm status changes to **Verified**.
4. Test email deliverability using the GRABIT vendor password reset flow (`/vendor/auth` → Forgot Password).

---

## 4. Security & Compliance Checklist

- [x] Resend API Key guarded with `import "server-only"`
- [x] Zero API keys in `NEXT_PUBLIC_*` or mobile builds
- [x] Dynamic links HTML-escaped to prevent XSS
- [x] Zero raw Supabase branding in visible transactional emails
- [ ] SPF DNS TXT record configured in domain registrar
- [ ] DKIM DNS TXT record configured in domain registrar
- [ ] DMARC DNS TXT record configured in domain registrar
