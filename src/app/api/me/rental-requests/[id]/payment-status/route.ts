import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { verifyAndSettlePayWayTransaction } from '@/lib/payway-settlement'
import { getStripeClient } from '@/lib/stripe'
import { failStripeCheckout, settleStripeCheckout } from '@/lib/stripe-settlement'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    const loadedRequest = await db.rentalRequest.findFirst({
      where: {
        OR: [{ id }, { requestNo: id }],
        renterId: user.id,
      },
      include: {
        paymentOrder: {
          include: {
            attempts: { orderBy: { createdAt: 'desc' } },
            receipt: true,
          },
        },
        depositLedger: true,
        inventoryHold: true,
      },
    })

    if (!loadedRequest) {
      return NextResponse.json({ error: 'Rental request not found' }, { status: 404 })
    }
    let request = loadedRequest

    const pendingPayWayAttempt = request.paymentOrder?.attempts.find(
      (attempt) => attempt.provider === 'ABA_PAYWAY' && attempt.status === 'PROCESSING' && attempt.providerReference
    )
    if (pendingPayWayAttempt?.providerReference) {
      try {
        await verifyAndSettlePayWayTransaction(pendingPayWayAttempt.providerReference)
        const refreshedRequest = await db.rentalRequest.findUnique({
          where: { id: request.id },
          include: {
            paymentOrder: {
              include: { attempts: { orderBy: { createdAt: 'desc' } }, receipt: true },
            },
            depositLedger: true,
            inventoryHold: true,
          },
        })
        if (!refreshedRequest) {
          return NextResponse.json({ error: 'Rental request not found' }, { status: 404 })
        }
        request = refreshedRequest
      } catch (error) {
        console.error('PayWay status verification failed:', error)
      }
    }

    const stripeSessionId = req.nextUrl.searchParams.get('session_id')
    if (stripeSessionId) {
      const stripeAttempt = request.paymentOrder?.attempts.find(
        (attempt) => attempt.provider === 'STRIPE_CHECKOUT' &&
          attempt.providerReference === stripeSessionId
      )

      if (!stripeAttempt) {
        return NextResponse.json({ error: 'Stripe checkout session not found for this rental.' }, { status: 404 })
      }

      try {
        const session = await getStripeClient().checkout.sessions.retrieve(stripeSessionId)
        if (session.status === 'expired') {
          await failStripeCheckout(session, 'Stripe Checkout session expired.')
        } else {
          await settleStripeCheckout(session)
        }

        const refreshedRequest = await db.rentalRequest.findUnique({
          where: { id: request.id },
          include: {
            paymentOrder: {
              include: { attempts: { orderBy: { createdAt: 'desc' } }, receipt: true },
            },
            depositLedger: true,
            inventoryHold: true,
          },
        })
        if (!refreshedRequest) {
          return NextResponse.json({ error: 'Rental request not found' }, { status: 404 })
        }
        request = refreshedRequest
      } catch (error) {
        console.error('Stripe checkout status reconciliation failed:', error)
        return NextResponse.json({ error: 'Unable to verify Stripe Checkout payment.' }, { status: 502 })
      }
    }

    return NextResponse.json({
      request_id: request.id,
      request_no: request.requestNo,
      request_status: request.status,
      payment_status: request.paymentOrder?.paymentStatus || 'UNPAID',
      payment_order: request.paymentOrder
        ? {
            id: request.paymentOrder.id,
            currency: request.paymentOrder.currency,
            totalDue: request.paymentOrder.totalDue,
            paymentStatus: request.paymentOrder.paymentStatus,
            dueAt: request.paymentOrder.dueAt,
            paidAt: request.paymentOrder.paidAt,
            attempts: request.paymentOrder.attempts.map(({ providerData: _providerData, ...attempt }) => attempt),
            receipt: request.paymentOrder.receipt,
          }
        : null,
      deposit_ledger: request.depositLedger,
      receipt: request.paymentOrder?.receipt || null,
      inventory_hold: request.inventoryHold,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch payment status' }, { status: 500 })
  }
}
