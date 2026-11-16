import type Stripe from 'stripe'
import { db } from '@/lib/db'
import { finalizeBookingReservation } from '@/lib/reservations'

export async function settleStripeCheckout(session: Stripe.Checkout.Session) {
  const attempt = await db.rentalPaymentAttempt.findFirst({
    where: { provider: 'STRIPE_CHECKOUT', providerReference: session.id },
    include: {
      paymentOrder: {
        include: { request: { include: { inventoryHold: true } } },
      },
    },
  })

  if (!attempt) throw new Error('Stripe checkout attempt not found.')
  if (
    session.metadata?.paymentAttemptId !== attempt.id ||
    session.metadata?.paymentOrderId !== attempt.paymentOrderId
  ) {
    throw new Error('Stripe checkout metadata did not match the payment attempt.')
  }

  const order = attempt.paymentOrder
  if (order.paymentStatus === 'PAID') return { payment_status: 'PAID' as const }
  if (order.paymentStatus === 'REQUIRES_REVIEW') return { payment_status: 'REQUIRES_REVIEW' as const }
  if (session.payment_status !== 'paid') return { payment_status: 'PENDING' as const }

  const amountMatches = session.amount_total === Math.round(order.totalDue * 100)
  const currencyMatches = session.currency?.toUpperCase() === order.currency.toUpperCase()
  const now = new Date()

  const settlement = await db.$transaction(async (tx) => {
    const currentOrder = await tx.rentalPaymentOrder.findUnique({
      where: { id: order.id },
      include: { request: { include: { inventoryHold: true } } },
    })
    if (!currentOrder) throw new Error('Stripe payment order no longer exists.')
    if (currentOrder.paymentStatus === 'PAID') return { paid: true, newlyPaid: false }
    if (currentOrder.paymentStatus === 'REQUIRES_REVIEW') return { paid: false, newlyPaid: false }

    const currentAttempt = await tx.rentalPaymentAttempt.findUnique({ where: { id: attempt.id } })
    if (!currentAttempt || currentAttempt.providerReference !== session.id) {
      throw new Error('Stripe payment attempt no longer matches the checkout session.')
    }

    const hold = currentOrder.request.inventoryHold
    const holdIsActive = hold && hold.status === 'ACTIVE' && new Date(hold.expiresAt) > now

    if (!amountMatches || !currencyMatches || !holdIsActive) {
      await tx.rentalPaymentOrder.update({
        where: { id: currentOrder.id },
        data: { paymentStatus: 'REQUIRES_REVIEW' },
      })
      await tx.rentalPaymentAttempt.update({
        where: { id: currentAttempt.id },
        data: {
          status: 'SUCCEEDED',
          failureReason: !amountMatches || !currencyMatches
            ? 'Stripe payment amount or currency did not match the order.'
            : 'Payment arrived after the inventory hold expired.',
        },
      })
      await tx.rentalRequestEvent.create({
        data: {
          requestId: currentOrder.requestId,
          actorId: 'SYSTEM',
          actorName: 'Stripe Webhook',
          actorType: 'SYSTEM',
          action: 'LATE_PAYMENT_HOLD_EXPIRED',
          fromStatus: currentOrder.request.status,
          toStatus: currentOrder.request.status,
          reason: !amountMatches || !currencyMatches
            ? `Stripe reported ${session.amount_total} ${session.currency || 'unknown currency'}; expected ${Math.round(order.totalDue * 100)} ${order.currency} minor units. Flagged for review.`
            : 'Stripe confirmed payment after the inventory hold expired. Flagged for review.',
        },
      })
      return { paid: false, newlyPaid: false }
    }

    const receiptCount = await tx.rentalPaymentReceipt.count()
    const receiptNo = `REC-${now.getFullYear()}-${(receiptCount + 1).toString().padStart(6, '0')}`

    await tx.rentalPaymentAttempt.update({
      where: { id: currentAttempt.id },
      data: { status: 'SUCCEEDED', failureReason: null },
    })
    await tx.rentalPaymentReceipt.create({
      data: {
        paymentOrderId: currentOrder.id,
        receiptNo,
        rentalAmount: currentOrder.rentalAmount,
        depositAmount: currentOrder.depositAmount,
        deliveryFee: currentOrder.deliveryFee,
        tax: currentOrder.tax,
        totalCaptured: currentOrder.totalDue,
        currency: currentOrder.currency,
        paymentMethod: 'CARD',
        issuedAt: now,
      },
    })
    await tx.rentalPaymentOrder.update({
      where: { id: currentOrder.id },
      data: { paymentStatus: 'PAID', paidAt: now },
    })

    if (currentOrder.depositAmount > 0) {
      await tx.rentalDepositLedger.upsert({
        where: { requestId: currentOrder.requestId },
        update: {
          collectedAmount: currentOrder.depositAmount,
          heldAmount: currentOrder.depositAmount,
          liabilityBalance: currentOrder.depositAmount,
          status: 'HELD',
        },
        create: {
          requestId: currentOrder.requestId,
          currency: currentOrder.currency,
          collectedAmount: currentOrder.depositAmount,
          heldAmount: currentOrder.depositAmount,
          liabilityBalance: currentOrder.depositAmount,
          status: 'HELD',
        },
      })
    }

    await tx.rentalRequest.update({
      where: { id: currentOrder.requestId },
      data: { status: 'PAYMENT_CONFIRMED', version: currentOrder.request.version + 1 },
    })
    await tx.rentalRequestEvent.create({
      data: {
        requestId: currentOrder.requestId,
        actorId: 'SYSTEM',
        actorName: 'Stripe Webhook',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CONFIRMED',
        fromStatus: currentOrder.request.status,
        toStatus: 'PAYMENT_CONFIRMED',
        reason: `Stripe verified card payment of ${currentOrder.totalDue} ${currentOrder.currency}.`,
      },
    })

    return { paid: true, newlyPaid: true }
  })

  if (settlement.newlyPaid) {
    try {
      await finalizeBookingReservation(order.requestId, {
        id: order.request.renterId,
        name: order.request.contactName,
        role: 'RENTER',
      })
    } catch (error) {
      console.error('Stripe booking finalization failed after payment:', error)
    }
  }

  return {
    payment_status: settlement.paid ? 'PAID' as const : 'REQUIRES_REVIEW' as const,
  }
}

export async function failStripeCheckout(session: Stripe.Checkout.Session, reason: string) {
  const attempt = await db.rentalPaymentAttempt.findFirst({
    where: { provider: 'STRIPE_CHECKOUT', providerReference: session.id },
    include: { paymentOrder: true },
  })
  if (!attempt) throw new Error('Stripe checkout attempt not found.')
  if (
    session.metadata?.paymentAttemptId !== attempt.id ||
    session.metadata?.paymentOrderId !== attempt.paymentOrderId
  ) {
    throw new Error('Stripe checkout metadata did not match the payment attempt.')
  }

  await db.$transaction(async (tx) => {
    const currentOrder = await tx.rentalPaymentOrder.findUnique({
      where: { id: attempt.paymentOrderId },
      select: { paymentStatus: true },
    })
    if (!currentOrder || currentOrder.paymentStatus === 'PAID' || currentOrder.paymentStatus === 'REQUIRES_REVIEW') {
      return
    }

    await tx.rentalPaymentAttempt.updateMany({
      where: { id: attempt.id, status: 'PROCESSING' },
      data: { status: 'FAILED', failureReason: reason },
    })

    const otherProcessingAttempts = await tx.rentalPaymentAttempt.count({
      where: {
        paymentOrderId: attempt.paymentOrderId,
        status: 'PROCESSING',
        id: { not: attempt.id },
      },
    })
    if (otherProcessingAttempts === 0) {
      await tx.rentalPaymentOrder.update({
        where: { id: attempt.paymentOrderId },
        data: { paymentStatus: 'FAILED' },
      })
    }
  })
}
