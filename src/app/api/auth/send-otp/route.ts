import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { setOtpForEmail, sendEmailOtp, normalizeEmail } from '@/lib/email-otp'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = normalizeEmail(body.email || '')

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { email },
    })

    if (!user) {
      return NextResponse.json({ error: 'No account was found for this email.' }, { status: 404 })
    }

    if (user.status === 'ACTIVE') {
      return NextResponse.json({ ok: true, message: 'This account is already verified.' })
    }

    const code = setOtpForEmail(email, user.id)
    await sendEmailOtp(email, code)

    return NextResponse.json({
      ok: true,
      message: 'A verification code has been sent to your email.',
      email,
    })
  } catch (error) {
    console.error('Send OTP error:', error)
    return NextResponse.json({ error: 'Unable to send verification code right now.' }, { status: 500 })
  }
}
