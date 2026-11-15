import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'
import { verifyAndSettlePayWayTransaction } from '@/lib/payway-settlement'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { id } = await params

    let request = await db.rentalRequest.findFirst({
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

    if (!request) {
      return NextResponse.json({ error: 'Rental request not found' }, { status: 404 })
    }

    const pendingPayWayAttempt = request.paymentOrder?.attempts.find(
      (attempt) => attempt.provider === 'ABA_PAYWAY' && attempt.status === 'PROCESSING' && attempt.providerReference
    )
    if (pendingPayWayAttempt?.providerReference) {
      try {
        await verifyAndSettlePayWayTransaction(pendingPayWayAttempt.providerReference)
        request = await db.rentalRequest.findUnique({
          where: { id: request.id },
          include: {
            paymentOrder: {
              include: { attempts: { orderBy: { createdAt: 'desc' } }, receipt: true },
            },
            depositLedger: true,
            inventoryHold: true,
          },
        })
        if (!request) {
          return NextResponse.json({ error: 'Rental request not found' }, { status: 404 })
        }
      } catch (error) {
        console.error('PayWay status verification failed:', error)
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
