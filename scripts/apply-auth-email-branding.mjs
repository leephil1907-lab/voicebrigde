#!/usr/bin/env node
/**
 * Applies VoiceBridge AI branded Supabase Auth email templates.
 * Requires SUPABASE_ACCESS_TOKEN with auth_config_read/auth_config_write permissions.
 * SMTP host, credentials, and sender address are deliberately left untouched.
 */
const projectRef = "kggllnqkryquornprphu";
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN before running this script.");
  process.exit(1);
}

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};

const frame = (title, content) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:32px 12px;background:#F4F7F3;font-family:Arial,Helvetica,sans-serif;color:#193B32;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3eae2;border-radius:16px;">
    <tr><td style="padding:30px 32px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="width:36px;height:36px;background:#193B32;color:#D5EF8B;border-radius:10px;text-align:center;vertical-align:middle;font-size:20px;font-weight:bold;">V</td>
        <td style="padding-left:10px;font-size:18px;font-weight:700;letter-spacing:-.3px;color:#193B32;">VoiceBridge AI</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:18px 32px 30px;">
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#193B32;">${title}</h1>
      ${content}
      <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#68786e;">If you did not request this, you can safely ignore this email.</p>
    </td></tr>
    <tr><td style="padding:18px 32px;border-top:1px solid #edf1eb;font-size:12px;color:#849187;">VoiceBridge AI · Your voice. Every language.</td></tr>
  </table>
</body></html>`;

const button = (label, url) => `<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:13px 22px;background:#193B32;color:#D5EF8B;text-decoration:none;border-radius:9px;font-weight:700;">${label}</a></p>`;
const paragraph = (text) => `<p style="margin:0;font-size:15px;line-height:1.7;color:#40534a;">${text}</p>`;

const templates = {
  confirmation: ["Confirm your email address", frame("Confirm your email", paragraph("Confirm your email address to finish creating your VoiceBridge AI account.") + button("Confirm email address", "{{ .ConfirmationURL }}"))],
  invite: ["You are invited to VoiceBridge AI", frame("You’re invited", paragraph("You have been invited to join VoiceBridge AI. Accept the invitation to get started.") + button("Accept invitation", "{{ .ConfirmationURL }}"))],
  magic_link: ["Your VoiceBridge sign-in link", frame("Sign in to VoiceBridge", paragraph("Use the secure link below to sign in to your account.") + button("Sign in", "{{ .ConfirmationURL }}"))],
  recovery: ["Reset your VoiceBridge password", frame("Reset your password", paragraph("We received a request to reset your VoiceBridge AI password. Continue using the secure link below.") + button("Reset password", "{{ .ConfirmationURL }}"))],
  email_change: ["Confirm your new email address", frame("Confirm your new email", paragraph("Confirm this email address to complete the change to your VoiceBridge AI account.") + button("Confirm email change", "{{ .ConfirmationURL }}"))],
  reauthentication: ["Your VoiceBridge verification code", frame("Confirm it’s you", paragraph("Enter this one-time verification code to continue:") + '<p style="margin:22px 0;font-size:30px;font-weight:700;letter-spacing:7px;color:#193B32;">{{ .Token }}</p>')],
  password_changed_notification: ["Your VoiceBridge password was changed", frame("Password changed", paragraph("The password for your VoiceBridge AI account was changed. If you did not make this change, secure your account immediately."))],
  email_changed_notification: ["Your VoiceBridge email was changed", frame("Email address changed", paragraph("The email address associated with your VoiceBridge AI account was changed. If you did not make this change, secure your account immediately."))],
  phone_changed_notification: ["Your VoiceBridge phone number was changed", frame("Phone number changed", paragraph("The phone number associated with your VoiceBridge AI account was changed. If you did not make this change, secure your account immediately."))],
  mfa_factor_enrolled_notification: ["A security factor was added to VoiceBridge", frame("Security factor added", paragraph("A new multi-factor authentication method was added to your VoiceBridge AI account. If you did not do this, secure your account immediately."))],
  mfa_factor_unenrolled_notification: ["A security factor was removed from VoiceBridge", frame("Security factor removed", paragraph("A multi-factor authentication method was removed from your VoiceBridge AI account. If you did not do this, secure your account immediately."))],
  identity_linked_notification: ["A sign-in method was linked to VoiceBridge", frame("Sign-in method linked", paragraph("A new sign-in identity was linked to your VoiceBridge AI account. If you did not do this, secure your account immediately."))],
  identity_unlinked_notification: ["A sign-in method was unlinked from VoiceBridge", frame("Sign-in method unlinked", paragraph("A sign-in identity was unlinked from your VoiceBridge AI account. If you did not do this, secure your account immediately."))],
};

const current = await fetch(endpoint, { headers: { Authorization: headers.Authorization } });
if (!current.ok) {
  console.error(`Could not read Supabase Auth config (${current.status}). Check the token permissions.`);
  process.exit(1);
}
const payload = { smtp_sender_name: "VoiceBridge AI" };
for (const [event, [subject, html]] of Object.entries(templates)) {
  payload[`mailer_subjects_${event}`] = subject;
  payload[`mailer_templates_${event}_content`] = html;
}

const update = await fetch(endpoint, { method: "PATCH", headers, body: JSON.stringify(payload) });
if (!update.ok) {
  console.error(`Supabase rejected the email template update (${update.status}): ${(await update.text()).slice(0, 500)}`);
  process.exit(1);
}

const verify = await fetch(endpoint, { headers: { Authorization: headers.Authorization } });
if (!verify.ok) {
  console.error("Templates were submitted, but the verification read failed.");
  process.exit(1);
}
const saved = await verify.json();
const checks = Object.keys(templates).map((event) => ({
  event,
  subject: saved[`mailer_subjects_${event}`],
  branded: String(saved[`mailer_templates_${event}_content`] || "").includes("VoiceBridge AI"),
}));
const failed = checks.filter((item) => !item.branded || !item.subject);
console.log(`Sender name: ${saved.smtp_sender_name}`);
console.log(`Verified branded templates: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) {
  console.error("Verification failed for:", failed.map((item) => item.event).join(", "));
  process.exit(1);
}
console.log("VoiceBridge Auth email templates are now branded. SMTP credentials were not changed.");
