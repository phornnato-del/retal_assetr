import Stripe from 'stripe'

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY.')
  }

  return new Stripe(secretKey)
}

export function getStripeWebhookSecret() {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    throw new Error('Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET.')
  }

  return webhookSecret
}

export function getAppBaseUrl() {
  const appUrl = process.env.APP_URL
  if (!appUrl) {
    throw new Error('Application URL is not configured. Set APP_URL.')
  }

  const url = new URL(appUrl)
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost)) {
    throw new Error('APP_URL must use HTTPS outside local development.')
  }

  return url.origin
}
