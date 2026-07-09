import nodemailer from "nodemailer";

export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const smtpHost = process.env.SMTP_HOST;

  if (!smtpHost) {
    // No SMTP configured (default for local dev): print the link instead of
    // requiring a real mail account so the reset flow stays testable.
    console.log(
      `\n[dev email] Password reset requested for ${email}\n[dev email] Reset link: ${resetUrl}\n`,
    );
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "AI Shopify Review Generator <noreply@example.com>",
    to: email,
    subject: "Reset your password",
    text: `Reset your password: ${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
    html: `<p>Reset your password by clicking the link below:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
  });
}
