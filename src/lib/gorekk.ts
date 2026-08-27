import {
  GOREKK_BASE_URL,
  GOREKK_STATIC_QR,
  GOREKK_CALLBACK_URL,
  GOREKK_EXPIRY_SECONDS,
  gorekkAuthHeader,
  assertGorekkConfig,
  GorekkConfigError,
} from './gorekk-config'

const CACHE_TTL_MS = 10000
const statusCache = new Map<string, { data: GorekkInvoiceStatusResponse; expiresAt: number }>()

export interface GorekkCreateQrisParams {
  amount: number
  orderId: string
  callbackUrl?: string
  expiresIn?: number
  uniqueAmount?: boolean
}

export interface GorekkCreateQrisResponse {
  success: boolean
  invoice_id: string
  image_url: string
  amount: number
  expires_at: string
  order_id: string
}

export interface GorekkInvoiceStatusResponse {
  success: boolean
  invoice_id: string
  status: 'pending' | 'paid' | 'expired' | 'failed'
  amount: number
  paid_at?: string
}

export async function createGorekkQris(
  params: GorekkCreateQrisParams
): Promise<GorekkCreateQrisResponse> {
  assertGorekkConfig()

  const url = new URL(`${GOREKK_BASE_URL}/qris/create`)
  url.searchParams.set('amount', String(params.amount))
  url.searchParams.set('static_qr', GOREKK_STATIC_QR)
  url.searchParams.set('order_id', params.orderId)
  url.searchParams.set('callback_url', params.callbackUrl || GOREKK_CALLBACK_URL)
  url.searchParams.set('expires_in', String(params.expiresIn || GOREKK_EXPIRY_SECONDS))
  if (params.uniqueAmount !== undefined) {
    url.searchParams.set('unique_amount', String(params.uniqueAmount))
  }

  const response = await fetch(url.toString(), {
    headers: gorekkAuthHeader(),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '(unreadable body)')
    throw new GorekkApiError(
      `Gorekk QRIS creation failed: ${response.status} ${text}`,
      'GOREKK_UPSTREAM_ERROR'
    )
  }

  const data = (await response.json()) as GorekkCreateQrisResponse
  if (!data.success || !data.invoice_id) {
    throw new GorekkApiError(
      'Gorekk returned an invalid response',
      'GOREKK_INVALID_RESPONSE'
    )
  }

  return data
}

function getCachedStatus(invoiceId: string): GorekkInvoiceStatusResponse | null {
  const cached = statusCache.get(invoiceId)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    statusCache.delete(invoiceId)
    return null
  }
  return cached.data
}

function setCachedStatus(invoiceId: string, data: GorekkInvoiceStatusResponse) {
  statusCache.set(invoiceId, { data, expiresAt: Date.now() + CACHE_TTL_MS })
}

export async function getGorekkInvoiceStatus(
  invoiceId: string
): Promise<GorekkInvoiceStatusResponse> {
  assertGorekkConfig()

  if (!invoiceId) {
    throw new GorekkApiError('Missing invoice_id', 'INVALID_REQUEST')
  }

  const cached = getCachedStatus(invoiceId)
  if (cached) {
    return cached
  }

  const url = new URL(`${GOREKK_BASE_URL}/qris/invoice`)
  url.searchParams.set('invoice_id', invoiceId)

  const response = await fetch(url.toString(), {
    headers: gorekkAuthHeader(),
  })

  if (response.status === 429) {
    const cached = getCachedStatus(invoiceId)
    if (cached) {
      return cached
    }
    const text = await response.text().catch(() => '(unreadable body)')
    throw new GorekkApiError(
      `Gorekk invoice check rate limited: ${text}`,
      'GOREKK_RATE_LIMITED'
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '(unreadable body)')
    throw new GorekkApiError(
      `Gorekk invoice check failed: ${response.status} ${text}`,
      'GOREKK_UPSTREAM_ERROR'
    )
  }

  const raw = await response.json()

  if (!raw || typeof raw !== 'object' || !raw.success) {
    throw new GorekkApiError(
      'Gorekk invoice check returned failure',
      'GOREKK_REQUEST_REJECTED'
    )
  }

  const data = raw as GorekkInvoiceStatusResponse
  if (!data || !data.status) {
    throw new GorekkApiError(
      'Gorekk returned an invalid response',
      'GOREKK_INVALID_RESPONSE'
    )
  }

  setCachedStatus(invoiceId, data)
  return data
}

export class GorekkApiError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}
