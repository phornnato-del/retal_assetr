import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createClientToken, setClientSessionCookie } from '@/lib/auth'
import { normalizeEmail, verifyOtpForEmail } from '@/lib/email-otp'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email = normalizeEmail(body.email || '')
    const code = String(body.code || '').trim()

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 })
    }

    if (!code || code.length !== 6) {
      return NextResponse.json({ error: 'Please enter the 6-digit verification code.' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { email },
    })

    if (!user) {
      return NextResponse.json({ error: 'Account not found.' }, { status: 404 })
    }

    if (user.status === 'ACTIVE') {
      return NextResponse.json({ ok: true, message: 'Your email is already verified.' })
    }

    const isValid = verifyOtpForEmail(email, code)

    if (!isValid) {
      return NextResponse.json({ error: 'Invalid or expired verification code.' }, { status: 401 })
    }

    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: {
        status: 'ACTIVE',
        lastLoginAt: new Date(),
      },
    })

    const token = await createClientToken({
      sub: updatedUser.id,
      email: updatedUser.email,
      name: updatedUser.name,
      role: 'client',
      avatar: updatedUser.avatar,
    }, '24h')

    const response = NextResponse.json({
      ok: true,
      message: 'Email verified successfully.',
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: 'client',
        avatar: updatedUser.avatar,
      },
    })

    setClientSessionCookie(response, token)

    return response
  } catch (error) {
    console.error('OTP verification error:', error)
    return NextResponse.json({ error: 'Failed to verify the code. Please try again.' }, { status: 500 })
  }
}
