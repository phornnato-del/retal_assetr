import { NextRequest, NextResponse } from 'next/server'
import { verifyPayWayCallback } from '@/lib/payway'
import { verifyAndSettlePayWayTransaction } from '@/lib/payway-settlement'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    if (!payload || typeof payload !== 'object' || typeof payload.tran_id !== 'string') {
      return NextResponse.json({ error: 'Invalid PayWay callback payload.' }, { status: 400 })
    }

    if (!verifyPayWayCallback(payload, request.headers.get('x-payway-hmac-sha512'))) {
      return NextResponse.json({ error: 'Invalid PayWay callback signature.' }, { status: 401 })
    }

    const result = await verifyAndSettlePayWayTransaction(payload.tran_id)
    return NextResponse.json({ received: true, ...result })
  } catch (error) {
    console.error('PayWay callback processing failed:', error)
    return NextResponse.json({ error: 'PayWay callback processing failed.' }, { status: 500 })
  }
}