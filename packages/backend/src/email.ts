import { Resend } from "resend";
import type { ResetEmail } from "./auth";

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
