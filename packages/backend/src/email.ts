import { Resend } from "resend";
import type { MagicLinkEmail, ResetEmail, VerificationEmail } from "./auth";

export function createResetEmailSender(
  apiKey: string | undefined,
  from: string | undefined,
) {
  const resend = apiKey ? new Resend(apiKey) : null;
  return async ({ to, url }: ResetEmail) => {
    if (!resend || !from)
      throw new Error(
        "Password reset email requires RESEND_API_KEY and EMAIL_FROM.",
      );
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Reset your Spectron password",
      text: `Open this link to choose a new password:\n\n${url}\n\nThis link expires in 30 minutes and can be used once. If you didn't request a password reset, you can ignore this email.`,
    });
    // Do not log the recipient, reset URL, API key, or provider response body.
    if (error) throw new Error("Password reset email could not be sent.");
  };
}

export function createInvitationEmailSender(
  apiKey: string | undefined,
  from: string | undefined,
) {
  const resend = apiKey ? new Resend(apiKey) : null;
  return async ({
    to,
    url,
    projectName,
    inviterName,
    invitationId,
  }: import("./project-invitations").InvitationEmail) => {
    if (!resend || !from)
      throw new Error(
        "Invitation email requires RESEND_API_KEY and EMAIL_FROM.",
      );
    const { error } = await resend.emails.send(
      {
        from,
        to,
        subject: `Invitation to ${projectName.replace(/[\r\n]/g, " ")} on Spectron`,
        text: `${inviterName} invited you to join ${projectName} on Spectron.\n\nAccept your invitation:\n${url}\n\nSign in or create an account using ${to}. This invitation expires in 7 days. If you weren’t expecting it, you can ignore this email.`,
      },
      { idempotencyKey: `project-invitation/${invitationId}` },
    );
    if (error) throw new Error("Invitation email could not be sent.");
  };
}

export function createMagicLinkEmailSender(
  apiKey: string | undefined,
  from: string | undefined,
) {
  const resend = apiKey ? new Resend(apiKey) : null;
  return async ({ to, url }: MagicLinkEmail) => {
    if (!resend || !from)
      throw new Error("Login link email requires RESEND_API_KEY and EMAIL_FROM.");
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Your Spectron login link",
      text: `Open this link to log in to Spectron:\n\n${url}\n\nIt expires in 10 minutes, works once, and signs in the device that opens it. If you didn't request it, you can ignore this email.`,
    });
    // Do not log the recipient, login URL, API key, or provider response body.
    if (error) throw new Error("Login link email could not be sent.");
  };
}

export function createVerificationEmailSender(
  apiKey: string | undefined,
  from: string | undefined,
) {
  const resend = apiKey ? new Resend(apiKey) : null;
  return async ({ to, url }: VerificationEmail) => {
    if (!resend || !from)
      throw new Error(
        "Verification email requires RESEND_API_KEY and EMAIL_FROM.",
      );
    const { error } = await resend.emails.send({
      from,
      to,
      subject: "Verify your email for Spectron",
      text: `Welcome to Spectron. Confirm that this address is yours:\n\n${url}\n\nThe link is valid for 24 hours. Verifying lets you log in with a link sent to this address as well as with your password. If you didn't create an account, you can ignore this email.`,
    });
    if (error) throw new Error("Verification email could not be sent.");
  };
}
