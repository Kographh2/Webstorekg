/**
 * Payment Utility Functions
 * Handles payment-related calculations and validations
 */

export interface PaymentConfig {
  gorekkApiKey: string
  gorekkStaticQr: string
  codEnabled: boolean
  minAmountForFreeShipping: number
  taxRate: number
  shippingCost: number
}

export const paymentConfig: PaymentConfig = {
  gorekkApiKey: process.env.GOREKK_API_KEY || '',
  gorekkStaticQr: process.env.GOREKK_STATIC_QR || '',
  codEnabled: process.env.NEXT_PUBLIC_COD_ENABLED !== 'false',
  minAmountForFreeShipping: 100000,
  taxRate: 0.1,
  shippingCost: 15000,
}

/**
 * Calculate shipping cost based on order amount
 */
export function calculateShipping(amount: number, isDigitalOrder: boolean = false): number {
  if (isDigitalOrder) return 0
  if (amount >= paymentConfig.minAmountForFreeShipping) return 0
  return paymentConfig.shippingCost
}

/**
 * Calculate tax amount
 */
export function calculateTaxAmount(amount: number): number {
  return Math.round(amount * paymentConfig.taxRate)
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Validate Indonesian phone number
 */
export function isValidPhoneNumber(phone: string): boolean {
  const phoneRegex = /^(\+62|62|0)[0-9]{9,12}$/
  return phoneRegex.test(phone.replace(/\s/g, ''))
}

/**
 * Format phone number to standard format
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1)
  } else if (!cleaned.startsWith('62')) {
    cleaned = '62' + cleaned
  }
  return cleaned
}

/**
 * Generate order ID
 */
export function generateOrderId(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `ORD-${timestamp}-${random}`
}

/**
 * Get payment method display name
 */
export function getPaymentMethodName(method: string): string {
  const methodNames: Record<string, string> = {
    cod: 'Bayar di Tempat (COD)',
    gorekk: 'Pembayaran Online',
    bank_transfer: 'Transfer Bank',
  }
  return methodNames[method] || method
}

/**
 * Get payment status display
 */
export function getPaymentStatusDisplay(status: string): {
  text: string
  color: string
  icon: string
} {
  const statuses: Record<string, { text: string; color: string; icon: string }> = {
    pending: { text: 'Menunggu Pembayaran', color: 'yellow', icon: '⏳' },
    pending_payment: { text: 'Pembayaran Sedang Diproses', color: 'blue', icon: '⌛' },
    confirmed: { text: 'Pembayaran Berhasil', color: 'green', icon: '✅' },
    failed: { text: 'Pembayaran Gagal', color: 'red', icon: '❌' },
    cancelled: { text: 'Pesanan Dibatalkan', color: 'gray', icon: '⛔' },
  }
  return statuses[status] || { text: status, color: 'gray', icon: '?' }
}

/**
 * Validate payment data
 */
export interface PaymentValidation {
  valid: boolean
  errors: string[]
}

export function validatePaymentData(data: {
  customerName: string
  email: string
  phone: string
  address?: string
  city?: string
  postalCode?: string
  amount: number
}): PaymentValidation {
  const errors: string[] = []

  if (!data.customerName?.trim()) {
    errors.push('Nama pelanggan harus diisi')
  }

  if (!data.email?.trim()) {
    errors.push('Email harus diisi')
  } else if (!isValidEmail(data.email)) {
    errors.push('Format email tidak valid')
  }

  if (!data.phone?.trim()) {
    errors.push('Nomor telepon harus diisi')
  } else if (!isValidPhoneNumber(data.phone)) {
    errors.push('Format nomor telepon tidak valid')
  }

  if (data.address && !data.address.trim()) {
    errors.push('Alamat harus diisi')
  }

  if (data.city && !data.city.trim()) {
    errors.push('Kota harus diisi')
  }

  if (data.postalCode && !data.postalCode.trim()) {
    errors.push('Kode pos harus diisi')
  }

  if (!data.amount || data.amount <= 0) {
    errors.push('Jumlah pembayaran tidak valid')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Create Gorekk QRIS request payload info
 */
export interface GorekkQrisRequestInfo {
  transaction_details: {
    order_id: string
    gross_amount: number
  }
  customer_details: {
    first_name: string
    email: string
    phone: string
    billing_address?: {
      first_name: string
      phone: string
      address: string
      city: string
      postal_code: string
      country_code: string
    }
    shipping_address?: {
      first_name: string
      phone: string
      address: string
      city: string
      postal_code: string
      country_code: string
    }
  }
  callbacks: {
    finish: string
    error: string
    pending: string
  }
  expiry: {
    unit: string
    length: number
  }
}

export function buildGorekkQrisRequest(
  orderId: string,
  amount: number,
  customer: {
    name: string
    email: string
    phone: string
    address?: string
    city?: string
    postalCode?: string
  },
  callbacks: {
    finish: string
    error: string
    pending: string
  }
): GorekkQrisRequestInfo {
  return {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    customer_details: {
      first_name: customer.name,
      email: customer.email,
      phone: formatPhoneNumber(customer.phone),
      ...(customer.address && {
        billing_address: {
          first_name: customer.name,
          phone: formatPhoneNumber(customer.phone),
          address: customer.address,
          city: customer.city || '',
          postal_code: customer.postalCode || '',
          country_code: 'IDN',
        },
        shipping_address: {
          first_name: customer.name,
          phone: formatPhoneNumber(customer.phone),
          address: customer.address,
          city: customer.city || '',
          postal_code: customer.postalCode || '',
          country_code: 'IDN',
        },
      }),
    },
    callbacks,
    expiry: {
      unit: 'minutes',
      length: 15,
    },
  }
}
