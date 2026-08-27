export const GOREKK_API_KEY = (process.env.GOREKK_API_KEY || '').trim()
export const GOREKK_STATIC_QR = (process.env.GOREKK_STATIC_QR || '').trim()
export const GOREKK_BASE_URL = 'https://www.gorekk.web.id/api/v1'
export const GOREKK_CALLBACK_URL = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/payments/gorekk-notification`
export const GOREKK_EXPIRY_SECONDS = 900

export function assertGorekkConfig(): void {
  if (!GOREKK_API_KEY) {
    throw new GorekkConfigError('GOREKK_API_KEY is not set')
  }
  if (!GOREKK_STATIC_QR) {
    throw new GorekkConfigError('GOREKK_STATIC_QR is not set')
  }
}

export class GorekkConfigError extends Error {
  code = 'GOREKK_CONFIG_MISSING' as const
}

export function gorekkAuthHeader(): Record<string, string> {
  return {
    'X-API-Key': GOREKK_API_KEY,
  }
}
