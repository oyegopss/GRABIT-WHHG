# GRABIT Project Checkpoint

**Checkpoint Date/Time**: 30 August 2026, 18:15 IST  
**Git Branch**: `main`  
**GitHub Repository**: `https://github.com/oyegopss/GRABIT-WHHG.git`  
**Production Domain**: `https://grabit.ventures`  

---

## 1. System Status Summary

| Surface / System | Status | Key Identifiers / Target |
| :--- | :--- | :--- |
| **Web Application** | LIVE | Deployed on Vercel (`https://grabit.ventures`) |
| **Student Android** | READY | `app.grabit.student` (`android/`) |
| **Vendor Android** | READY | `com.grabit.vendor` (`vendor-mobile/android/`) |
| **Automated Tests** | 62/62 PASS | 100% test coverage across all subsystems |
| **Security Hardening** | SECURE | 0 Critical / 0 High vulnerabilities, rate limiting active |
| **Payment Gateway** | SANDBOX | Cashfree PG (`lib/payments/cashfree.ts`) |
| **Payouts & Settlement**| SANDBOX | Cashfree Payouts (`lib/payments/cashfree_payouts.ts`) |
| **Email Service** | READY | Resend GRABIT-branded transactional emails |

---

## 2. Completed Architecture Invariants & Features

1. **Role Surfaces**:
   - Student Portal: `/student` and `/customer`
   - Vendor Portal: `/vendor` (with isolated `/vendor/auth` and password reset)
   - Super Admin Portal: `/superadmin`
2. **Mobile Coexistence**:
   - `app.grabit.student` and `com.grabit.vendor` are distinct, standalone Android apps.
3. **Financial Security**:
   - Server-authoritative order pricing and line item calculations.
   - Cashfree webhook HMAC-SHA256 signature verification with constant-time equality.
   - Payment idempotency table (`payment_webhook_events`) preventing duplicate credits.
   - SuperAdmin restricted vendor settlement payouts with double-payout state locks.
4. **Campus Architecture**:
   - Single active campus per student session.
   - GPS campus auto-detection comparing distance to all supported campuses dynamically.
   - Campus-specific popular items queries.
5. **Vendor Operations**:
   - Exactly-once vendor ring sound alert on verified payment.
   - Real-time internal Notifications Center with All / Unread / Read filtering.
   - Role-branded vendor password reset flow with zero Supabase mentions.
6. **API Security & Abuse Protection**:
   - Sliding-window rate limiting on auth, payments, payouts, and orders.
   - Standard HTTP 429 response with `Retry-After` and `X-RateLimit-*` headers.
   - Zero server-only credentials in `NEXT_PUBLIC_*` or mobile bundles.
   - `productionBrowserSourceMaps: false` and `poweredByHeader: false` in `next.config.ts`.
   - Security headers: HSTS (max-age 2 years), X-Frame-Options DENY, X-Content-Type-Options nosniff.

---

## 3. Known Manual Production Actions

1. **DNS DKIM Record**: Add TXT record `resend._domainkey` in your domain registrar for `grabit.ventures` (exact value in Resend Dashboard).
2. **DNS SPF Record**: Add TXT record `"v=spf1 include:amazonses.com ~all"` on root domain `grabit.ventures`.
3. **DNS DMARC Record**: Add TXT record `"v=DMARC1; p=none; rua=mailto:dmarc-reports@grabit.ventures; pct=100; sp=none; aspf=r;"` on `_dmarc.grabit.ventures`.
4. **Cashfree Production Switch**: When merchant live onboarding is approved by Cashfree, set `CASHFREE_ENVIRONMENT=PRODUCTION` and insert live credentials into Vercel environment settings.

---

## 4. How to Restore / Run After Reopening Laptop

```bash
# 1. Navigate to workspace
cd /Users/gopaljidwivedi/GRABIT-WHHG

# 2. Pull latest checkpoint
git pull origin main

# 3. Start local development server (Web)
npm run dev

# 4. Run automated test suites
npm test

# 5. Build Android APKs
# Student:
cd android && ./gradlew assembleDebug
# Vendor:
cd ../vendor-mobile/android && ./gradlew assembleDebug
```
