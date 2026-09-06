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
