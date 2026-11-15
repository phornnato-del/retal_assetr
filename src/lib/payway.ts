import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_PAYWAY_BASE_URL = 'https://checkout-sandbox.payway.com.kh'
const QR_ENDPOINT = '/api/payment-gateway/v1/payments/generate-qr'
const CHECK_ENDPOINT = '/api/payment-gateway/v1/payments/check-transaction-2'

type PayWayStatus = {
  code?: string | number
  message?: string
  trace_id?: string
}

export type PayWayTransactionStatus = {
  data?: {
    payment_status_code?: number
    payment_status?: string
    total_amount?: number
    payment_amount?: number
    payment_currency?: string
    apv?: string
  }
  status?: PayWayStatus
}

function payWayConfig() {
  const merchantId = process.env.PAYWAY_MERCHANT_ID
  const apiKey = process.env.PAYWAY_API_KEY

  if (!merchantId || !apiKey) {
    throw new Error('PayWay is not configured. Set PAYWAY_MERCHANT_ID and PAYWAY_API_KEY.')
  }
  if (/^https?:\/\//i.test(apiKey)) {
    throw new Error('PAYWAY_API_KEY must be the API key issued by ABA, not a URL. Set the endpoint host with PAYWAY_BASE_URL.')
  }

  return {
    merchantId,
    apiKey,
    baseUrl: (process.env.PAYWAY_BASE_URL || DEFAULT_PAYWAY_BASE_URL).replace(/\/$/, ''),
  }
}

export function getPayWayCacheContext() {
  const { baseUrl, merchantId } = payWayConfig()
  return JSON.stringify([baseUrl, merchantId])
}

function requestTime() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
}

function sign(values: string[], apiKey: string) {
  return createHmac('sha512', apiKey).update(values.join('')).digest('base64')
}

async function postPayWay<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  const result = await response.json().catch(() => null) as {
    status?: PayWayStatus
    message?: string
    error?: string
  } | null

  if (!response.ok) {
    const details = [
      result?.status?.code ? `code ${result.status.code}` : '',
      result?.status?.message || result?.message || result?.error || '',
      result?.status?.trace_id ? `trace ${result.status.trace_id}` : '',
    ].filter(Boolean).join('; ')
    throw new Error(`PayWay request failed with HTTP ${response.status}${details ? `: ${details}` : '.'}`)
  }
  if (!result) {
    throw new Error(`PayWay returned an invalid response with HTTP ${response.status}.`)
  }

  return result as T
}

export async function createPayWayQr(input: {
  tranId: string
  amount: number
  currency: string
  itemName: string
  quantity: number
  firstName: string
  lastName: string
  email: string
  phone: string
  lifetime: number
}) {
  const { merchantId, apiKey, baseUrl } = payWayConfig()
  const reqTime = requestTime()
  const amount = Number(input.amount.toFixed(2))
  const items = Buffer.from(JSON.stringify([
    { name: input.itemName, quantity: input.quantity, price: input.amount },
  ])).toString('base64')
  const callbackUrl = process.env.PAYWAY_CALLBACK_URL
    ? Buffer.from(process.env.PAYWAY_CALLBACK_URL).toString('base64')
    : ''
  const paymentOption = 'abapay_khqr'
  const purchaseType = 'purchase'
  const currency = input.currency.toUpperCase()
  const lifetime = String(input.lifetime)
  const qrImageTemplate = 'template3_color'

  const hash = sign([
    reqTime,
    merchantId,
    input.tranId,
    String(amount),
    items,
    input.firstName,
    input.lastName,
    input.email,
    input.phone,
    purchaseType,
    paymentOption,
    callbackUrl,
    '',
    currency,
    '',
    '',
    '',
    lifetime,
    qrImageTemplate,
  ], apiKey)

  const result = await postPayWay<{
    status?: PayWayStatus
    qrString?: string
    qrImage?: string
    abapay_deeplink?: string
    amount?: number
    currency?: string
  }>(`${baseUrl}${QR_ENDPOINT}`, {
    req_time: reqTime,
    merchant_id: merchantId,
    tran_id: input.tranId,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    amount,
    purchase_type: purchaseType,
    payment_option: paymentOption,
    items,
    currency,
    callback_url: callbackUrl,
    return_deeplink: '',
    custom_fields: '',
    return_params: '',
    payout: '',
    lifetime: input.lifetime,
    qr_image_template: qrImageTemplate,
    hash,
  })

  if (String(result.status?.code) !== '0' || !result.qrString || !result.qrImage) {
    throw new Error(result.status?.message || 'PayWay did not return a valid payment QR.')
  }

  return {
    tranId: input.tranId,
    qrString: result.qrString,
    qrImage: result.qrImage,
    abapayDeeplink: result.abapay_deeplink || null,
    amount: result.amount ?? input.amount,
    currency: result.currency || currency,
  }
}

export async function checkPayWayTransaction(tranId: string) {
  const { merchantId, apiKey, baseUrl } = payWayConfig()
  const reqTime = requestTime()
  const hash = sign([reqTime, merchantId, tranId], apiKey)

  return postPayWay<PayWayTransactionStatus>(`${baseUrl}${CHECK_ENDPOINT}`, {
    req_time: reqTime,
    merchant_id: merchantId,
    tran_id: tranId,
    hash,
  })
}

export function verifyPayWayCallback(payload: Record<string, unknown>, receivedSignature: string | null) {
  const { apiKey } = payWayConfig()
  if (!receivedSignature) return false

  const signedPayload = Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => key.toLowerCase() !== 'hash')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  const values = Object.values(signedPayload).map((value) => {
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
  const expected = Buffer.from(sign(values, apiKey))
  const received = Buffer.from(receivedSignature)

  return expected.length === received.length && timingSafeEqual(expected, received)
}