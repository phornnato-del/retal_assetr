import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripeClient, getStripeWebhookSecret } from '@/lib/stripe'
import { failStripeCheckout, settleStripeCheckout } from '@/lib/stripe-settlement'

export async function POST(request: NextRequest) {
  let event: Stripe.Event
  try {
    const stripe = getStripeClient()
    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      return NextResponse.json({ error: 'Missing Stripe signature.' }, { status: 400 })
    }

    event = stripe.webhooks.constructEvent(
      await request.text(),
      signature,
      getStripeWebhookSecret()
    )
  } catch (error) {
    console.error('Stripe webhook signature verification failed:', error)
    const message = error instanceof Error ? error.message : ''
    const status = message.includes('not configured') ? 500 : 400
    return NextResponse.json(
      { error: status === 400 ? 'Invalid Stripe webhook signature.' : 'Stripe webhook is not configured.' },
      { status }
    )
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as Stripe.Checkout.Session
      const result = await settleStripeCheckout(session)
      return NextResponse.json({ received: true, ...result })
    }

    if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session
      const reason = event.type === 'checkout.session.expired'
        ? 'Stripe Checkout session expired.'
        : 'Stripe reported that the asynchronous payment failed.'
      await failStripeCheckout(session, reason)
      return NextResponse.json({ received: true, payment_status: 'FAILED' })
    }

    return NextResponse.json({ received: true, ignored: true })
  } catch (error) {
    console.error('Stripe webhook processing failed:', error)
    return NextResponse.json({ error: 'Stripe webhook processing failed.' }, { status: 500 })
  }
}
