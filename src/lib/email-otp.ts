import nodemailer from 'nodemailer'

const otpStore = new Map<string, { code: string; expiresAt: number; userId: string }>()

export function normalizeEmail(value: string) {
  return (value || '').trim().toLowerCase()
}

export function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export function setOtpForEmail(email: string, userId: string) {
  const normalized = normalizeEmail(email)
  const code = generateOtpCode()
  otpStore.set(normalized, {
    code,
    userId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  })

  return code
}

export function getPendingOtp(email: string) {
  const normalized = normalizeEmail(email)
  const entry = otpStore.get(normalized)

  if (!entry) return null

  if (entry.expiresAt < Date.now()) {
    otpStore.delete(normalized)
    return null
  }

  return entry
}

export function verifyOtpForEmail(email: string, code: string) {
  const entry = getPendingOtp(email)
  const supplied = String(code || '').trim()

  if (!entry || supplied.length !== 6) return false

  if (supplied !== entry.code) return false

  otpStore.delete(normalizeEmail(email))
  return true
}

export function clearOtpForEmail(email: string) {
  otpStore.delete(normalizeEmail(email))
}

export async function sendEmailOtp(email: string, code: string) {
  const normalized = normalizeEmail(email)
  const smtpHost = process.env.SMTP_HOST

  if (!smtpHost) {
    console.log(`[OTP TEST MODE] Verification code for ${normalized}: ${code}`)
    return { mode: 'console' as const }
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'Asset Rental <noreply@localhost>',
    to: normalized,
    subject: 'Your Asset Rental verification code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #0f172a;">
        <h2 style="margin-bottom: 12px;">Asset Rental email verification</h2>
        <p style="margin: 0 0 16px;">Your verification code is:</p>
        <div style="display:inline-block; padding: 16px 20px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 10px; font-size: 28px; font-weight: 700; letter-spacing: 0.2em; color: #064e3b;">${code}</div>
        <p style="margin-top: 20px; margin-bottom: 0;">This code expires in 5 minutes.</p>
      </div>
    `,
  })

  return { mode: 'smtp' as const }
}
