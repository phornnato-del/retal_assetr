import { db } from '@/lib/db'
import { finalizeBookingReservation } from '@/lib/reservations'
import { checkPayWayTransaction } from '@/lib/payway'

export async function verifyAndSettlePayWayTransaction(tranId: string) {
  const gatewayResult = await checkPayWayTransaction(tranId)
  const gatewayCode = String(gatewayResult.status?.code)

  if (gatewayCode !== '00') {
    throw new Error(gatewayResult.status?.message || 'PayWay transaction status could not be verified.')
  }

  const gatewayPayment = gatewayResult.data
  if (!gatewayPayment) throw new Error('PayWay returned no transaction details.')

  const attempt = await db.rentalPaymentAttempt.findFirst({
    where: { provider: 'ABA_PAYWAY', providerReference: tranId },
    include: {
      paymentOrder: {
        include: { request: { include: { inventoryHold: true } } },
      },
    },
  })

  if (!attempt) return { payment_status: 'NOT_FOUND' as const }

  const order = attempt.paymentOrder
  if (order.paymentStatus === 'PAID') return { payment_status: 'PAID' as const }
  if (order.paymentStatus === 'REQUIRES_REVIEW') return { payment_status: 'REQUIRES_REVIEW' as const }

  if (gatewayPayment.payment_status !== 'APPROVED' || gatewayPayment.payment_status_code !== 0) {
    if (gatewayPayment.payment_status === 'DECLINED' || gatewayPayment.payment_status === 'CANCELLED') {
      await db.$transaction(async (tx) => {
        await tx.rentalPaymentAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', failureReason: gatewayPayment.payment_status },
        })
        await tx.rentalPaymentOrder.update({
          where: { id: order.id },
          data: { paymentStatus: 'FAILED' },
        })
      })
      return { payment_status: gatewayPayment.payment_status }
    }

    return { payment_status: 'PENDING' as const }
  }

  const paidAmount = Number(gatewayPayment.total_amount ?? gatewayPayment.payment_amount)
  const currencyMatches = gatewayPayment.payment_currency?.toUpperCase() === order.currency.toUpperCase()
  const amountMatches = Number.isFinite(paidAmount) && Math.round(paidAmount * 100) === Math.round(order.totalDue * 100)
  const now = new Date()

  const settlement = await db.$transaction(async (tx) => {
    const currentOrder = await tx.rentalPaymentOrder.findUnique({
      where: { id: order.id },
      include: { request: { include: { inventoryHold: true } } },
    })

    if (!currentOrder) throw new Error('Payment order no longer exists.')
    if (currentOrder.paymentStatus === 'PAID') return { paid: true, newlyPaid: false }

    const currentAttempt = await tx.rentalPaymentAttempt.findUnique({ where: { id: attempt.id } })
    if (!currentAttempt) throw new Error('PayWay payment attempt no longer exists.')

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
            ? 'PayWay payment amount or currency did not match the order.'
            : 'Payment arrived after the inventory hold expired.',
        },
      })
      await tx.rentalRequestEvent.create({
        data: {
          requestId: currentOrder.requestId,
          actorId: 'SYSTEM',
          actorName: 'PayWay Verification',
          actorType: 'SYSTEM',
          action: 'LATE_PAYMENT_HOLD_EXPIRED',
          fromStatus: currentOrder.request.status,
          toStatus: currentOrder.request.status,
          reason: !amountMatches || !currencyMatches
            ? `PayWay reported ${paidAmount} ${gatewayPayment.payment_currency || 'unknown currency'}; expected ${order.totalDue} ${order.currency}. Flagged for review.`
            : 'PayWay confirmed payment after the inventory hold expired. Flagged for review.',
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
        paymentMethod: 'KHQR',
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
          collectedAmount: currentOrder.depositAmount,
          heldAmount: currentOrder.depositAmount,
          liabilityBalance: currentOrder.depositAmount,
          currency: currentOrder.currency,
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
        actorName: 'PayWay Verification',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CONFIRMED',
        fromStatus: currentOrder.request.status,
        toStatus: 'PAYMENT_CONFIRMED',
        reason: `PayWay verified KHQR payment of ${currentOrder.totalDue} ${currentOrder.currency}.`,
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
      console.error('PayWay booking finalization failed after payment:', error)
    }
  }

  return { payment_status: settlement.paid ? 'PAID' as const : 'REQUIRES_REVIEW' as const }
}