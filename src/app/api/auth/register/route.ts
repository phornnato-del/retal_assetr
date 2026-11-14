import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { setOtpForEmail, sendEmailOtp, clearOtpForEmail } from '@/lib/email-otp'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, name, phone } = body

    const cleanEmail = (email || '').trim().toLowerCase()
    const cleanName = (name || '').trim()
    const cleanPhone = (phone || '').trim()

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return NextResponse.json({ error: 'Please provide a valid email address.' }, { status: 400 })
    }

    if (!cleanName || cleanName.length < 2) {
      return NextResponse.json({ error: 'Please enter your full name (minimum 2 characters).' }, { status: 400 })
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters long.' },
        { status: 400 }
      )
    }

    const existing = await db.user.findUnique({
      where: { email: cleanEmail },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email address already exists. Please sign in instead.' },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(password)

    const avatarUrl = `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(cleanName)}&backgroundColor=b6e3f4`

    let newUser

    try {
      newUser = await db.user.create({
        data: {
          email: cleanEmail,
          name: cleanName,
          phone: cleanPhone || null,
          passwordHash,
          avatar: avatarUrl,
          role: 'client',
          status: 'PENDING_VERIFICATION',
          lastLoginAt: null,
        },
      })

      const code = setOtpForEmail(cleanEmail, newUser.id)
      await sendEmailOtp(cleanEmail, code)
    } catch (error) {
      if (newUser?.id) {
        try {
          await db.user.delete({ where: { id: newUser.id } })
        } catch (deleteError) {
          console.error('Failed to rollback created user after registration OTP failure:', deleteError)
        }
      }

      clearOtpForEmail(cleanEmail)

      console.error('Registration setup failed. Rolled back user creation:', error)

      return NextResponse.json(
        { error: 'We could not send the verification code. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Account created. We sent a 6-digit verification code to your email.',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: 'client',
        avatar: newUser.avatar,
      },
    })
  } catch (error: any) {
    console.error('Registration error:', error)
    return NextResponse.json(
      { error: 'An error occurred during registration. Please try again.' },
      { status: 500 }
    )
  }
}
