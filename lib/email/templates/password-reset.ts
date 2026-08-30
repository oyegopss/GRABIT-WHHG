function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PasswordResetEmailData {
  /** The real Supabase-generated recovery link — never a hand-built URL. */
  actionLink: string;
  role?: "vendor" | "student" | "superadmin";
}

/**
 * GRABIT-branded password reset email. The button always points at the
 * exact `actionLink` Supabase Auth generated (via
 * admin.generateLink({ type: "recovery" })) — this template never
 * constructs or guesses a reset URL itself, and never sees or stores
 * the underlying recovery token.
 */
export function renderPasswordResetEmail(data: PasswordResetEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const isVendor = data.role === "vendor";
  const subject = isVendor ? "Reset your GRABIT Vendor password" : "Reset your GRABIT password";
  const safeLink = escapeHtml(data.actionLink);

  const accountTypeLabel = isVendor ? "GRABIT Vendor" : "GRABIT";
  const footerTagline = isVendor
    ? "Secure vendor operations for campus food businesses."
    : "The smartest way to order food across campus canteens.";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#141414;border-radius:18px;border:1px solid #262626;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,0.6);">
          <!-- Header -->
          <tr>
            <td style="padding:28px 32px 20px 32px;text-align:center;border-bottom:1px solid #222222;background:linear-gradient(180deg, #1a1a1a 0%, #141414 100%);">
              <div style="font-size:24px;font-weight:900;letter-spacing:0.04em;color:#ff7a00;line-height:1.2;">
                GRABIT
              </div>
              <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888888;margin-top:4px;">
                Campus Canteen OS ${isVendor ? "· Vendor Portal" : ""}
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:800;color:#ffffff;line-height:1.3;">
                Reset your password
              </h1>
              <p style="margin:0 0 20px 0;font-size:14px;color:#d4d4d4;line-height:1.6;">
                We received a request to reset the password for your <strong>${accountTypeLabel}</strong> account.
              </p>
              <p style="margin:0 0 28px 0;font-size:14px;color:#d4d4d4;line-height:1.6;">
                Click the button below to securely create a new password.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px auto;width:100%;">
                <tr>
                  <td align="center">
                    <a href="${safeLink}" style="display:inline-block;padding:14px 36px;font-size:14px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;color:#0a0a0a;background-color:#ff7a00;text-decoration:none;border-radius:12px;box-shadow:0 4px 16px rgba(255,122,0,0.35);">
                      RESET PASSWORD
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <div style="background-color:#1c1c1c;border:1px solid #2a2a2a;border-radius:10px;padding:14px;margin-bottom:20px;">
                <p style="margin:0;font-size:12px;color:#a3a3a3;line-height:1.5;">
                  ⏱️ <strong>Security note:</strong> This link will expire after a limited period for security reasons.
                </p>
              </div>

              <p style="margin:0 0 16px 0;font-size:12px;color:#737373;line-height:1.6;">
                If you didn't request a password reset, you can safely ignore this email — your account password will remain unchanged.
              </p>

              <div style="border-top:1px solid #222222;padding-top:16px;margin-top:20px;">
                <p style="margin:0;font-size:12px;color:#737373;">
                  Need help? Contact <a href="mailto:support.grabit@gmail.com" style="color:#ff7a00;text-decoration:none;font-weight:600;">support.grabit@gmail.com</a>
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;background-color:#0d0d0d;border-top:1px solid #202020;text-align:center;">
              <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;color:#888888;letter-spacing:0.04em;">
                © GRABIT · Campus Canteen OS
              </p>
              <p style="margin:0;font-size:10px;color:#555555;">
                ${footerTagline}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `GRABIT — Campus Canteen OS ${isVendor ? "· Vendor Portal" : ""}

Reset your password

We received a request to reset the password for your ${accountTypeLabel} account.
Click the link below to securely create a new password:

${data.actionLink}

This link will expire after a limited period for security reasons.
If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged.

Need help? Contact support.grabit@gmail.com

© GRABIT · Campus Canteen OS
${footerTagline}`;

  return { subject, html, text };
}
