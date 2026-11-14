'use client'

import { useState, Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Boxes, UserCheck, ArrowLeft, UserPlus, Clock, ShieldCheck } from 'lucide-react'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'

function CustomerLoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') || '/'
  const isExpired = searchParams.get('expired') === '1'

  const [mode, setMode] = useState<'login' | 'register'>('login')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)

  const [regName, setRegName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regPassword, setRegPassword] = useState('')
  const [regConfirmPassword, setRegConfirmPassword] = useState('')
  const [showRegPw, setShowRegPw] = useState(false)

  const [verificationPending, setVerificationPending] = useState(false)
  const [pendingEmail, setPendingEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  const handleLogin = async (e?: React.FormEvent, directUsername?: string, directPassword?: string) => {
    if (e) e.preventDefault()
    setError('')
    setLoading(true)

    const identityToUse = (directUsername || username || '').trim()
    const passwordToUse = directPassword || password

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: identityToUse,
          password: passwordToUse || 'RenterPassword123!',
        }),
      })

      const data = await res.json()

      if (res.ok) {
        window.location.href = from || '/'
      } else {
        if (res.status === 403 && data.error?.toLowerCase().includes('verify')) {
          setVerificationPending(true)
          setPendingEmail(identityToUse)
          setOtp('')
          setMode('login')
        }
        setError(data.error || 'Invalid credentials. Please try again.')
      }
    } catch {
      setError('Something went wrong. Please check your network and try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSendOtp = async (email: string) => {
    if (!email || !email.includes('@')) {
      setError('Please provide a valid email address.')
      return
    }

    const response = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    const data = await response.json()

    if (!response.ok) {
      setError(data.error || 'Unable to send OTP right now.')
      return false
    }

    setVerificationPending(true)
    setPendingEmail(email)
    setOtp('')
    setResendCooldown(30)
    setError(data.message || 'Verification code sent.')
    return true
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (regPassword !== regConfirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          phone: regPhone,
          password: regPassword,
        }),
      })

      const data = await res.json()

      if (res.ok) {
        setVerificationPending(true)
        setPendingEmail(regEmail.trim().toLowerCase())
        setOtp('')
        setResendCooldown(30)
        setError(data.message || 'Account created. Please verify your email.')
      } else {
        setError(data.error || 'Registration failed. Please try again.')
      }
    } catch {
      setError('Something went wrong during registration. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    const email = pendingEmail || regEmail
    if (!email || otp.length !== 6) {
      setError('Please enter the 6-digit verification code.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: otp }),
      })

      const data = await res.json()

      if (res.ok) {
        setVerificationPending(false)
        setError('')
        setOtp('')
        window.location.href = from || '/'
      } else {
        setError(data.error || 'Verification failed. Please try again.')
      }
    } catch {
      setError('Unable to verify the code right now. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    const email = pendingEmail || regEmail
    if (!email) {
      setError('Please provide your email first.')
      return
    }

    await handleSendOtp(email)
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden font-sans">
      <div className="hidden md:flex w-1/2 h-full bg-white flex-col">
        <div className="flex items-center gap-2.5 px-10 pt-10 pb-0">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#0d4a2e] text-white flex items-center justify-center shadow">
              <Boxes className="h-5 w-5" />
            </div>
            <span className="text-[17px] font-bold tracking-tight text-slate-800">
              Asset <span className="text-[#16a34a]">Rental</span>
            </span>
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center px-12">
          <div className="w-full max-w-md">
            <div className="relative">
              <div className="absolute inset-[-8%] rounded-[50%] bg-[#eaf6ee] blur-2xl opacity-80 pointer-events-none" />
              <img
                src="/customer-login-illustration.jpg"
                alt="Rent equipment, cameras, drones and camping gear"
                className="relative z-10 w-full rounded-3xl object-cover shadow-xl border border-slate-100"
              />
            </div>
            <p className="text-center text-slate-700 text-sm font-semibold mt-6">
              Rent Anything. Own Nothing.
            </p>
            <p className="text-center text-slate-400 text-xs mt-1">
              Explore cameras, drones, laptops, and outdoor equipment on demand.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between px-10 pb-8 text-[11px] text-slate-400">
          <p>© 2026 Asset Rental · Customer Portal</p>
          <Link href="/admin/login" className="text-slate-400 hover:text-emerald-700 transition">
            Admin Portal →
          </Link>
        </div>
      </div>

      <div className="w-full md:w-1/2 h-full bg-[#0d4a2e] flex flex-col justify-center px-8 sm:px-12 lg:px-20 relative overflow-y-auto">
        <div className="absolute -top-20 -right-20 h-64 w-64 rounded-full bg-[#16a34a]/20 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 h-52 w-52 rounded-full bg-[#16a34a]/15 blur-3xl pointer-events-none" />

        <div className="relative z-10 w-full max-w-sm mx-auto py-8">
          <div className="flex items-center gap-2 mb-6 md:hidden">
            <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center">
              <Boxes className="h-4 w-4 text-white" />
            </div>
            <span className="text-white font-bold text-base">Asset Rental</span>
          </div>

          <div className="flex rounded-xl bg-black/20 p-1 mb-6 border border-white/10">
            <button
              type="button"
              onClick={() => { setMode('login'); setError('') }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-[#16a34a] text-white shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError('') }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-[#16a34a] text-white shadow-md'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="mb-6">
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              {mode === 'login' ? 'Client Portal Login' : 'Create a Client Account'}
            </h1>
            <p className="text-xs sm:text-sm text-white/50 mt-1">
              {mode === 'login'
                ? 'Sign in as a client to browse assets, request rentals, and manage bookings'
                : 'Join RentHub to explore and rent high-demand equipment'}
            </p>
          </div>

          {isExpired && !error && (
            <div className="mb-5 text-xs text-amber-200 bg-amber-500/15 border border-amber-400/30 rounded-xl px-4 py-3 flex items-center gap-2.5">
              <Clock className="h-4 w-4 shrink-0 text-amber-300" />
              <span>Your session has expired. Please sign in again to continue.</span>
            </div>
          )}

          {verificationPending ? (
            <div className="rounded-[28px] border border-emerald-300/30 bg-white/5 p-5 shadow-2xl shadow-emerald-950/20 backdrop-blur-sm">
              <div className="flex items-center justify-center mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-300/30">
                  <ShieldCheck className="h-6 w-6" />
                </div>
              </div>

              <h2 className="text-center text-2xl font-bold tracking-tight text-white">Verify your email</h2>
              <p className="mt-2 text-center text-sm text-emerald-50/80">
                We sent a 6-digit code to <span className="font-semibold text-white">{pendingEmail || regEmail}</span>
              </p>

              <div className="mt-5 flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otp}
                  onChange={setOtp}
                  containerClassName="gap-2"
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} className="h-12 w-12 rounded-xl border-white/20 bg-[#0b3d25] text-xl font-semibold text-white" />
                    <InputOTPSlot index={1} className="h-12 w-12 rounded-xl border-white/20 bg-[#0b3d25] text-xl font-semibold text-white" />
                    <InputOTPSlot index={2} className="h-12 w-12 rounded-xl border-white/20 bg-[#0b3d25] text-xl font-semibold text-white" />
                    <InputOTPSlot index={3} className="h-12 w-12 rounded-xl border-white/20 bg-[#0b3d25] text-xl font-semibold text-white" />
                    <InputOTPSlot index={4} className="h-12 w-12 rounded-xl border-white/20 bg-[#0b3d25] text-xl font-semibold text-white" />
                    <InputOTPSlot index={5} className="h-12 w-12 rounded-xl border-white/20 bg-[#0b3d25] text-xl font-semibold text-white" />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={loading || otp.length !== 6}
                className="mt-5 w-full rounded-xl bg-[#16a34a] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#15803d] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Verifying…' : 'Verify code'}
              </button>

              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/10 px-3 py-2 text-xs text-white/70">
                <span>Didn’t receive the code?</span>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown > 0 || loading}
                  className="font-semibold text-emerald-200 disabled:opacity-50"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
                </button>
              </div>

              {error && (
                <p className="mt-4 text-xs text-red-200 bg-red-500/10 border border-red-400/20 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}
            </div>
          ) : mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  Email or Username
                </label>
                <div className="relative">
                  <input
                    id="customer-identity"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="e.g. you@renthub.app"
                    required
                    autoComplete="email"
                    className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 focus:border-[#16a34a]/40 transition"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="customer-password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2.5 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 focus:border-[#16a34a]/40 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/65 transition"
                    tabIndex={-1}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-3.5 py-2">
                  {error}
                </p>
              )}

              <button
                id="customer-login-btn"
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-[#16a34a] hover:bg-[#15803d] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-all shadow-lg shadow-black/20 mt-1"
              >
                {loading ? (
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <UserCheck className="h-4 w-4" />
                )}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g. Sokha Meng"
                  required
                  className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Phone (Optional)
                </label>
                <input
                  type="tel"
                  value={regPhone}
                  onChange={(e) => setRegPhone(e.target.value)}
                  placeholder="+855 12 345 678"
                  className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Password (min 6 characters)
                </label>
                <div className="relative">
                  <input
                    type={showRegPw ? 'text' : 'password'}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create a secure password"
                    required
                    minLength={6}
                    className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/65 transition"
                    tabIndex={-1}
                  >
                    {showRegPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Confirm Password
                </label>
                <input
                  type={showRegPw ? 'text' : 'password'}
                  value={regConfirmPassword}
                  onChange={(e) => setRegConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  required
                  className="w-full rounded-xl bg-[#0b3d25] border border-white/10 text-white placeholder:text-white/25 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#16a34a]/60 transition"
                />
              </div>

              {error && (
                <p className="text-xs text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl px-3.5 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-[#16a34a] hover:bg-[#15803d] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl text-sm transition-all shadow-lg shadow-black/20 mt-1"
              >
                {loading ? (
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {loading ? 'Creating Account…' : 'Complete Registration'}
              </button>
            </form>
          )}

          <div className="mt-5 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-[#16a34a] hover:text-emerald-300 transition font-medium"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Continue browsing assets without signing in
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CustomerLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0d4a2e] flex items-center justify-center text-white">
          <span className="h-8 w-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <CustomerLoginForm />
    </Suspense>
  )
}
