'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  QrCode,
  Banknote,
  Building2,
  Shield,
  Clock,
  Calendar,
  Truck,
  AlertTriangle,
  AlertCircle,
  Loader2,
  ArrowLeft,
  DollarSign,
  FileText,
} from 'lucide-react'
import { Header } from '@/components/rental/Header'
import { Footer } from '@/components/rental/Footer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

type PaymentMethod = 'KHQR' | 'BANK_TRANSFER' | 'CASH'

export default function RentalPaymentCheckoutPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('KHQR')
  const [bankRef, setBankRef] = useState('')
  const [cashNote, setCashNote] = useState('')
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [idempotencyKey] = useState(
    () => `PAY-IDEM-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  )
  const [paywayQr, setPaywayQr] = useState<{
    tran_id: string
    qr_image: string
    qr_string: string
    abapay_deeplink: string | null
    expires_at: string
  } | null>(null)
  const qrExpiryTime = paywayQr ? Date.parse(paywayQr.expires_at) : null
  const qrSecondsRemaining =
    qrExpiryTime === null
      ? null
      : Number.isFinite(qrExpiryTime)
        ? Math.max(0, Math.ceil((qrExpiryTime - clockNow) / 1000))
        : 0

  // Fetch Payment Summary
  const { data, isLoading, error } = useQuery({
    queryKey: ['payment-summary', id],
    queryFn: async () => {
      const res = await fetch(`/api/me/rental-requests/${id}/payment-summary`)
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to load payment checkout summary')
      }
      return res.json()
    },
    refetchInterval: 10000,
  })

  const paywayStatusQuery = useQuery({
    queryKey: ['payway-payment-status', id, paywayQr?.tran_id],
    enabled: Boolean(paywayQr) && qrSecondsRemaining !== 0,
    queryFn: async () => {
      const res = await fetch(`/api/me/rental-requests/${id}/payment-status`, { cache: 'no-store' })
      const status = await res.json()
      if (!res.ok) throw new Error(status.error || 'Unable to verify PayWay payment')
      return status
    },
    refetchInterval: paywayQr && qrSecondsRemaining !== 0 ? 5000 : false,
  })

  useEffect(() => {
    if (paywayStatusQuery.data?.payment_status === 'PAID') {
      toast.success('PayWay payment confirmed! Rental reserved.')
      router.push(`/rentals/requests/${id}/receipt`)
    }
  }, [id, paywayStatusQuery.data?.payment_status, router])

  useEffect(() => {
    if (!paywayQr?.expires_at) return
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [paywayQr?.expires_at])

  // Payment Attempt Mutation
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/me/rental-requests/${id}/payment-attempts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          method: paymentMethod,
          bank_transfer_reference: paymentMethod === 'BANK_TRANSFER' ? bankRef : undefined,
          cash_notes: paymentMethod === 'CASH' ? cashNote : undefined,
          idempotency_key: idempotencyKey,
        }),
      })

      const resData = await res.json()
      if (!res.ok) {
        throw new Error(resData.error || 'Payment failed')
      }
      if (paymentMethod === 'KHQR' &&
        (resData.payment_method !== 'KHQR' ||
          resData.status !== 'PENDING' ||
          !resData.qr_image ||
          !Number.isFinite(Date.parse(resData.expires_at)))) {
        throw new Error('ABA PayWay did not return a payment QR.')
      }
      return resData
    },
    onSuccess: (resData) => {
      if (resData.payment_method === 'KHQR') {
        setClockNow(Date.now())
        setPaywayQr({
          tran_id: resData.tran_id,
          qr_image: resData.qr_image,
          qr_string: resData.qr_string,
          abapay_deeplink: resData.abapay_deeplink,
          expires_at: resData.expires_at,
        })
        toast.success('ABA PayWay QR created. Scan it to complete payment.')
      } else if (resData.payment_method === 'CASH') {
        toast.success('Cash payment registered. Pay at the counter when you pick up the equipment.')
        router.push('/rentals/my-requests')
      } else if (resData.payment_method === 'BANK_TRANSFER') {
        toast.success('Bank transfer submitted for manual verification.')
        router.push('/rentals/my-requests')
      } else if (resData.status === 'PAID') {
        toast.success('Payment captured! Rental confirmed.')
        router.push(`/rentals/requests/${id}/receipt`)
      } else {
        toast.error('The payment response was not recognized. Please contact support.')
      }
    },
    onError: (err: any) => {
      toast.error(err.message || 'Payment execution failed')
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600 mb-2" />
          <p className="text-xs text-muted-foreground">Loading payment checkout...</p>
        </div>
        <Footer />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <main className="flex-1 max-w-lg mx-auto w-full px-4 py-16 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
          <h2 className="text-xl font-bold mb-1">Cannot Initialize Checkout</h2>
          <p className="text-sm text-muted-foreground mb-6">
            {error ? (error as any).message : 'Unable to load payment details.'}
          </p>
          <Button asChild className="bg-emerald-600 hover:bg-emerald-700">
            <Link href="/rentals/my-requests">Return to My Requests</Link>
          </Button>
        </main>
        <Footer />
      </div>
    )
  }

  // If already paid, redirect to receipt
  if (data.status === 'PAYMENT_CONFIRMED') {
    router.push(`/rentals/requests/${id}/receipt`)
    return null
  }

  const isHoldExpired = data.is_hold_expired || !data.is_payable
  const remainingMinutes = Math.floor(data.remaining_seconds / 60)
  const remainingSecs = data.remaining_seconds % 60
  const breakdown = data.commercial_breakdown
  const asset = data.asset

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-background flex flex-col">
      <Header />

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 py-8">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
          <Link href="/rentals/my-requests" className="hover:text-foreground flex items-center gap-1">
            <ArrowLeft className="h-3 w-3" />
            My Requests
          </Link>
          <span>/</span>
          <span className="font-mono font-semibold text-foreground">{data.request_no}</span>
          <span>/</span>
          <span className="text-emerald-600 font-semibold">Payment & Deposit (Step 05)</span>
        </div>

        {/* Hold Expiration / Deadline Timer Banner */}
        {isHoldExpired ? (
          <div className="mb-6 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Inventory Hold Window Elapsed</p>
              <p className="mt-0.5">
                The payment deadline for this approval has passed. The temporary equipment hold was released back to the general inventory pool. Please submit a new request or contact support to request reapproval.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3 text-xs">
                <Link href="/rentals/my-requests">Back to My Requests</Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-900 dark:text-emerald-200 text-xs flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Clock className="h-5 w-5 text-emerald-600 shrink-0" />
              <div>
                <p className="font-bold text-sm">Inventory Hold Active</p>
                <p className="text-[11px] text-muted-foreground">
                  Equipment units are held exclusively for your booking until the payment window expires.
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold block">Time Remaining:</span>
              <span className="font-mono text-base font-black text-emerald-600">
                {remainingMinutes}:{remainingSecs.toString().padStart(2, '0')}
              </span>
            </div>
          </div>
        )}

        {/* 2-Column Checkout Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column (7 cols): Payment Breakdown & Methods */}
          <div className="lg:col-span-7 space-y-6">
            {/* 1. Itemized Financial Breakdown */}
            <Card className="shadow-sm border-border">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  Itemized Charges & Security Deposit
                </CardTitle>
                <CardDescription className="text-xs">
                  Separating rental service fee from refundable liability deposit.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                {/* Section A: Rental Charges */}
                <div className="space-y-2">
                  <span className="font-bold text-foreground text-xs block">
                    1. Rental & Fulfillment Fees
                  </span>
                  <div className="flex justify-between text-muted-foreground pl-2">
                    <span>
                      Equipment Usage (${breakdown.unit_rate}/day × {asset.rental_days}d × {asset.quantity} unit):
                    </span>
                    <span className="font-semibold text-foreground">
                      ${breakdown.rental_charges.rental_subtotal.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground pl-2">
                    <span>Fulfillment Delivery Fee:</span>
                    <span className="font-semibold text-foreground">
                      {breakdown.rental_charges.delivery_fee > 0
                        ? `$${breakdown.rental_charges.delivery_fee.toFixed(2)}`
                        : 'Free (Pickup Hub)'}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground pl-2">
                    <span>Estimated Regional Taxes:</span>
                    <span className="font-semibold text-foreground">$0.00</span>
                  </div>
                  <div className="flex justify-between font-medium text-foreground pt-1 border-t border-border/40 pl-2">
                    <span>Subtotal Rental Charges:</span>
                    <span>${breakdown.rental_charges.subtotal_due.toFixed(2)}</span>
                  </div>
                </div>

                {/* Section B: Refundable Security Deposit */}
                <div className="pt-2 border-t border-border/60 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-foreground text-xs flex items-center gap-1.5">
                      2. Refundable Security Deposit
                      <Shield className="h-3.5 w-3.5 text-emerald-600" />
                    </span>
                    <span className="font-bold text-foreground">
                      ${breakdown.refundable_deposit.amount.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border/60">
                    {breakdown.refundable_deposit.terms_note}
                  </p>
                </div>

                {/* Total */}
                <div className="pt-3 border-t border-border flex items-baseline justify-between">
                  <div>
                    <span className="text-sm font-extrabold text-foreground">Total Due Now:</span>
                    <p className="text-[11px] text-muted-foreground">Currency: {breakdown.currency} (Fixed)</p>
                  </div>
                  <span className="text-2xl font-black text-emerald-600">
                    ${breakdown.total_due.toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* 2. Payment Options */}
            <Card className="shadow-sm border-border">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold">Choose how to pay</CardTitle>
                <CardDescription className="text-xs">
                  Select a payment method for ${breakdown.total_due.toFixed(2)} {breakdown.currency}.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <RadioGroup
                  value={paymentMethod}
                  disabled={
                    Boolean(paywayQr) &&
                    qrSecondsRemaining !== 0 &&
                    !['FAILED', 'DECLINED', 'CANCELLED'].includes(paywayStatusQuery.data?.payment_status)
                  }
                  onValueChange={(value) => {
                    if (value === 'KHQR' || value === 'BANK_TRANSFER' || value === 'CASH') {
                      setPaymentMethod(value)
                    }
                  }}
                  className="space-y-2"
                >
                  <Label
                    htmlFor="pay-khqr"
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                      paymentMethod === 'KHQR'
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <RadioGroupItem value="KHQR" id="pay-khqr" className="mt-0.5" />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-xs font-bold">
                        <QrCode className="h-4 w-4 text-emerald-600" />
                        ABA KHQR / ABA PAY
                      </span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Scan the PayWay QR using ABA Mobile or another supported KHQR app.
                      </span>
                    </span>
                  </Label>

                  <Label
                    htmlFor="pay-bank"
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                      paymentMethod === 'BANK_TRANSFER'
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <RadioGroupItem value="BANK_TRANSFER" id="pay-bank" className="mt-0.5" />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-xs font-bold">
                        <Building2 className="h-4 w-4 text-emerald-600" />
                        Bank transfer
                      </span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Submit your transfer reference for manual verification.
                      </span>
                    </span>
                  </Label>

                  <Label
                    htmlFor="pay-cash"
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                      paymentMethod === 'CASH'
                        ? 'border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <RadioGroupItem value="CASH" id="pay-cash" className="mt-0.5" />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-xs font-bold">
                        <Banknote className="h-4 w-4 text-emerald-600" />
                        Cash on pickup
                      </span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        Pay at the counter when you collect the equipment.
                      </span>
                    </span>
                  </Label>
                </RadioGroup>

                {paymentMethod === 'KHQR' && (
                  <div className="rounded-xl border bg-muted/20 p-4">
                    {paywayQr ? (
                      <div className="flex flex-col items-center text-center">
                        <img
                          src={paywayQr.qr_image}
                          alt="ABA PayWay KHQR payment code"
                          className="h-64 w-64 max-w-full rounded-lg border bg-white object-contain p-2 sm:h-72 sm:w-72"
                        />
                        <p className="mt-3 text-sm font-bold">Scan to pay ${breakdown.total_due.toFixed(2)}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Transaction {paywayQr.tran_id}
                        </p>
                        {qrSecondsRemaining !== null && (
                          <p
                            className={`mt-2 text-xs font-semibold ${
                              qrSecondsRemaining === 0 ? 'text-destructive' : 'text-amber-700'
                            }`}
                            aria-live="polite"
                          >
                            {qrSecondsRemaining === 0
                              ? 'This QR has expired.'
                              : `QR expires in ${Math.floor(qrSecondsRemaining / 60)
                                  .toString()
                                  .padStart(2, '0')}:${(qrSecondsRemaining % 60).toString().padStart(2, '0')}`}
                          </p>
                        )}
                        {paywayQr.abapay_deeplink && (
                          <a
                            href={paywayQr.abapay_deeplink}
                            className="mt-2 text-xs font-semibold text-emerald-700 underline"
                          >
                            Open ABA Mobile
                          </a>
                        )}
                        {qrSecondsRemaining !== 0 &&
                          (paywayStatusQuery.data?.payment_status === 'REQUIRES_REVIEW' ? (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Payment received; support is reviewing the transaction.
                            </p>
                          ) : ['FAILED', 'DECLINED', 'CANCELLED'].includes(paywayStatusQuery.data?.payment_status) ? (
                            <p className="mt-3 text-xs text-destructive">
                              This QR was not paid. Generate a new one to try again.
                            </p>
                          ) : (
                            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                              Waiting for PayWay to confirm payment…
                            </p>
                          ))}
                        {(qrSecondsRemaining === 0 ||
                          ['FAILED', 'DECLINED', 'CANCELLED'].includes(paywayStatusQuery.data?.payment_status)) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => setPaywayQr(null)}
                          >
                            Create a new payment QR
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="py-5 text-center">
                        <p className="text-sm font-semibold">Your QR will appear here</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Select Payment below to create a secure, time-limited PayWay QR.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {paymentMethod === 'BANK_TRANSFER' && (
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs text-muted-foreground">
                      Use the verified bank account details provided by the rental company, then enter your transaction reference.
                    </p>
                    <Label htmlFor="bank-reference" className="text-xs font-semibold">
                      Transfer reference
                    </Label>
                    <Input
                      id="bank-reference"
                      value={bankRef}
                      onChange={(event) => setBankRef(event.target.value)}
                      placeholder="Enter your bank transaction reference"
                      className="text-sm"
                    />
                  </div>
                )}

                {paymentMethod === 'CASH' && (
                  <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
                    <p className="text-xs text-muted-foreground">
                      Pay ${breakdown.total_due.toFixed(2)} {breakdown.currency} at the service counter during pickup.
                    </p>
                    <Label htmlFor="cash-note" className="text-xs font-semibold">
                      Note <span className="font-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <Input
                      id="cash-note"
                      value={cashNote}
                      onChange={(event) => setCashNote(event.target.value)}
                      placeholder="Add a note for the counter staff"
                      className="text-sm"
                    />
                  </div>
                )}

                <Button
                  onClick={() => paymentMutation.mutate()}
                  disabled={
                    isHoldExpired ||
                    paymentMutation.isPending ||
                    (paymentMethod === 'KHQR' && Boolean(paywayQr)) ||
                    (paymentMethod === 'BANK_TRANSFER' && !bankRef.trim())
                  }
                  className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base shadow-sm gap-2 transition-all"
                >
                  {paymentMutation.isPending ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Processing...
                    </>
                  ) : paymentMethod === 'KHQR' && paywayQr ? (
                    <>
                      <Clock className="h-4 w-4" />
                      Waiting for payment
                    </>
                  ) : (
                    'Payment'
                  )}
                </Button>

                <p className="text-center text-[11px] text-muted-foreground flex items-center justify-center gap-1">
                  <Shield className="h-3.5 w-3.5 text-emerald-600" />
                  Your payment details are sent securely over HTTPS.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Right Column (5 cols): Equipment Summary & Terms */}
          <div className="lg:col-span-5 space-y-6">
            {/* Asset Summary */}
            <Card className="shadow-sm border-border">
              <CardHeader className="pb-3 border-b border-border/60">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-emerald-600" />
                  Equipment Reservation Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="h-16 w-16 rounded-xl overflow-hidden bg-muted border shrink-0">
                    <img
                      src={asset.cover_image || 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=300&q=80'}
                      alt={asset.name}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-sm text-foreground truncate">{asset.name}</h4>
                    <p className="text-muted-foreground font-mono text-[11px] mt-0.5">{asset.code}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Quantity: <strong className="text-foreground">{asset.quantity} unit(s)</strong>
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-muted/40 border border-border/60 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-emerald-600" />
                      Rental Duration:
                    </span>
                    <span className="font-semibold text-foreground">{asset.rental_days} Day(s)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      {asset.fulfillment === 'PICKUP' ? (
                        <Building2 className="h-3.5 w-3.5 text-emerald-600" />
                      ) : (
                        <Truck className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      Fulfillment:
                    </span>
                    <span className="font-semibold text-foreground">
                      {asset.fulfillment} ({asset.location_city})
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Deposit Terms & Liability Policy */}
            <Card className="shadow-xs border-emerald-500/20 bg-emerald-50/20 dark:bg-emerald-950/10">
              <CardHeader className="p-4 pb-2">
                <CardTitle className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-emerald-600" />
                  Refundable Deposit Liability Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-1 space-y-2 text-xs text-muted-foreground leading-relaxed">
                <p>
                  • The security deposit is held in a dedicated customer escrow ledger and does not form part of RentHub operational revenue.
                </p>
                <p>
                  • Upon physical return inspection in Step 10, the full deposit balance is promptly refunded minus any documented physical damages or late turnaround fees.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  )
}
