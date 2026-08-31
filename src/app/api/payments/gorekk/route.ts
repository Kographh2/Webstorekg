import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  createGorekkQris,
  getGorekkInvoiceStatus,
  GorekkApiError,
} from '@/lib/gorekk'
import { assertGorekkConfig, GorekkConfigError } from '@/lib/gorekk-config'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface PaymentRequest {
  orderId: string
  amount: number
  email: string
  phone: string
  customerName: string
  paymentMethod: 'gorekk' | 'cod'
  itemDetails: Array<{
    id: string
    price: number
    quantity: number
    name: string
  }>
  shippingAddress?: {
    full_name: string
    phone: string
    email: string
    address: string
    city: string
    postal_code: string
  }
}

interface OrderRow {
  id: string
  status: string
  payment_status: string
  total_amount: number
  user_id: string
}

function validatePayload(
  grossAmount: number,
  itemDetails: PaymentRequest['itemDetails']
): string | null {
  if (!Number.isFinite(grossAmount) || Number.isNaN(grossAmount)) {
    return 'gross_amount is not a valid number'
  }
  if (grossAmount <= 0) {
    return 'gross_amount must be greater than 0'
  }
  if (!Array.isArray(itemDetails) || itemDetails.length === 0) {
    return 'item_details is empty'
  }

  let itemsSum = 0
  for (const item of itemDetails) {
    if (!Number.isFinite(item.price) || item.price < 0) {
      return `invalid price for item "${item.name}"`
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return `invalid quantity for item "${item.name}"`
    }
    itemsSum += Math.round(item.price) * item.quantity
  }

  if (Math.abs(itemsSum - Math.round(grossAmount)) > 1) {
    return `item_details total (${itemsSum}) does not match gross_amount (${Math.round(grossAmount)})`
  }

  return null
}

async function triggerOrderPaidEmails(orderId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  // Fire-and-forget, same as the webhook does. Both endpoints are
  // idempotent (guarded by invoice_sent_at / digital_delivered_at on
  // the order), so triggering from both the webhook AND this polling
  // path is safe — this just makes sure the emails still go out even
  // if Gorekk's webhook never reaches us and the buyer finds out their
  // order is paid purely through this status-check endpoint instead.
  fetch(`${baseUrl}/api/invoices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  }).catch((err) => console.error('Error triggering invoice email:', err))

  fetch(`${baseUrl}/api/products/send-digital`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  }).catch((err) => console.error('Error triggering digital product email:', err))
}

async function updateOrderPaid(orderId: string) {
  const { error } = await supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      status: 'paid',
      payment_confirmed_at: new Date().toISOString(),
    })
    .eq('id', orderId)

  if (error) {
    console.error('Error updating order to paid:', error)
    return
  }

  triggerOrderPaidEmails(orderId)
}

async function updateOrderFailed(orderId: string, status: string) {
  const updatePayload: Record<string, unknown> = {
    payment_status: status === 'expired' ? 'expired' : 'failed',
  }
  if (status === 'expired' || status === 'failed') {
    updatePayload.status = 'cancelled'
  }

  const { error } = await supabase
    .from('orders')
    .update(updatePayload)
    .eq('id', orderId)

  if (error) {
    console.error('Error updating order status:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PaymentRequest = await request.json()

    if (!body.orderId || !body.amount || !body.email) {
      return NextResponse.json(
        { error: 'Missing required fields', code: 'INVALID_REQUEST' },
        { status: 400 }
      )
    }

    const { data: existingOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id, status, payment_status, total_amount, user_id')
      .eq('id', body.orderId)
      .single()

    if (orderFetchError || !existingOrder) {
      return NextResponse.json(
        { error: 'Order not found', code: 'ORDER_NOT_FOUND' },
        { status: 404 }
      )
    }

    const order = existingOrder as unknown as OrderRow

    if (order.payment_status === 'paid') {
      return NextResponse.json({
        success: true,
        status: 'paid',
        orderId: order.id,
        message: 'Order already paid',
        redirectUrl: `/payment-status/success?order_id=${order.id}`,
      })
    }

    const serverAmount = Math.round(order.total_amount)
    if (Math.round(body.amount) !== serverAmount) {
      return NextResponse.json(
        { error: 'Amount mismatch. Please refresh and try again.', code: 'AMOUNT_MISMATCH' },
        { status: 400 }
      )
    }

    if (body.paymentMethod === 'cod') {
      return NextResponse.json({
        success: true,
        status: order.status,
        orderId: order.id,
        message: 'COD orders do not require online payment processing',
        redirectUrl: `/payment-status/success?order_id=${order.id}&method=cod`,
      })
    }

    if (body.paymentMethod === 'gorekk') {
      try {
        assertGorekkConfig()
      } catch (configError) {
        if (configError instanceof GorekkConfigError) {
          console.error('Gorekk configuration error:', configError.message)
          return NextResponse.json(
            { error: 'Payment gateway configuration is missing', code: configError.code },
            { status: 500 }
          )
        }
        throw configError
      }

      const validationError = validatePayload(serverAmount, body.itemDetails)
      if (validationError) {
        return NextResponse.json(
          { error: `Invalid payment payload: ${validationError}`, code: 'INVALID_PAYLOAD' },
          { status: 400 }
        )
      }

      try {
        const qrisResponse = await createGorekkQris({
          amount: serverAmount,
          orderId: body.orderId,
        })

        const { error: updateError } = await supabase
          .from('orders')
          .update({
            transaction_id: qrisResponse.invoice_id,
            snap_redirect_url: qrisResponse.image_url,
            expires_at: new Date(qrisResponse.expires_at).toISOString(),
          })
          .eq('id', body.orderId)

        if (updateError) {
          console.error('Error saving transaction reference:', updateError)
        }

        return NextResponse.json({
          success: true,
          status: 'pending',
          invoiceId: qrisResponse.invoice_id,
          imageUrl: qrisResponse.image_url,
          amount: qrisResponse.amount,
          expiresAt: qrisResponse.expires_at,
          orderId: body.orderId,
        })
      } catch (error) {
        console.error('Unexpected error creating Gorekk transaction:', error)
        if (error instanceof GorekkApiError) {
          return NextResponse.json(
            { error: error.message, code: error.code },
            { status: 502 }
          )
        }
        return NextResponse.json(
          { error: 'Failed to process payment', code: 'PAYMENT_PROCESSING_ERROR' },
          { status: 500 }
        )
      }
    }

    return NextResponse.json(
      { error: 'Invalid payment method', code: 'INVALID_PAYMENT_METHOD' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Unexpected API error in /api/payments/gorekk POST:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const orderId = request.nextUrl.searchParams.get('orderId')
    const invoiceId = request.nextUrl.searchParams.get('invoiceId')

    if (!orderId && !invoiceId) {
      return NextResponse.json(
        { error: 'orderId or invoiceId is required', code: 'INVALID_REQUEST' },
        { status: 400 }
      )
    }

    let resolvedInvoiceId = invoiceId

    if (!resolvedInvoiceId && orderId) {
      const { data: existingOrder, error } = await supabase
        .from('orders')
        .select('id, status, payment_status, transaction_id')
        .eq('id', orderId)
        .single()

      if (error || !existingOrder) {
        return NextResponse.json(
          { error: 'Order not found', code: 'ORDER_NOT_FOUND' },
          { status: 404 }
        )
      }

      const order = existingOrder as unknown as {
        id: string
        status: string
        payment_status: string
        transaction_id: string | null
      }

      if (order.payment_status === 'paid') {
        return NextResponse.json({
          status: 'paid',
          orderId: order.id,
          redirectUrl: `/payment-status/success?order_id=${orderId}`,
        })
      }

      if (order.payment_status === 'failed' || order.payment_status === 'expired') {
        return NextResponse.json({
          status: order.payment_status,
          orderId: order.id,
          redirectUrl: `/payment-status/failed?order_id=${orderId}&reason=${order.payment_status}`,
        })
      }

      resolvedInvoiceId = order.transaction_id
    }

    if (!resolvedInvoiceId) {
      return NextResponse.json(
        { error: 'Invoice ID not found for this order', code: 'INVOICE_NOT_FOUND' },
        { status: 404 }
      )
    }

    try {
      const statusData = await getGorekkInvoiceStatus(resolvedInvoiceId)
      const rawStatus = String(statusData.status || 'pending').toLowerCase()
      let gorekkStatus: 'pending' | 'paid' | 'failed' | 'expired' = 'pending'

      if (rawStatus === 'paid' || rawStatus === 'success' || rawStatus === 'settlement' || rawStatus === 'capture') {
        gorekkStatus = 'paid'
      } else if (rawStatus === 'failed' || rawStatus === 'deny' || rawStatus === 'cancel') {
        gorekkStatus = 'failed'
      } else if (rawStatus === 'expired' || rawStatus === 'expire') {
        gorekkStatus = 'expired'
      }

      let newPaymentStatus: string | null = null
      let newStatus: string | null = null

      if (gorekkStatus === 'paid') {
        newPaymentStatus = 'paid'
        newStatus = 'paid'
      } else if (gorekkStatus === 'failed' || gorekkStatus === 'expired') {
        newPaymentStatus = gorekkStatus
        newStatus = 'cancelled'
      }

      const targetOrderId = orderId || resolvedInvoiceId

      if (newPaymentStatus && targetOrderId) {
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('payment_status')
          .eq('id', targetOrderId)
          .single()

        const currentStatus = (currentOrder as unknown as { payment_status: string } | null)?.payment_status

        if (newPaymentStatus !== currentStatus) {
          if (newPaymentStatus === 'paid') {
            await updateOrderPaid(targetOrderId)
          } else {
            await updateOrderFailed(targetOrderId, newPaymentStatus)
          }
        }

        if (newPaymentStatus === 'paid') {
          return NextResponse.json({
            status: 'paid',
            orderId: targetOrderId,
            redirectUrl: `/payment-status/success?order_id=${targetOrderId}`,
          })
        }
        if (newPaymentStatus === 'failed' || newPaymentStatus === 'expired') {
          return NextResponse.json({
            status: newPaymentStatus,
            orderId: targetOrderId,
            redirectUrl: `/payment-status/failed?order_id=${targetOrderId}&reason=${newPaymentStatus}`,
          })
        }
      }

      return NextResponse.json({
        status: 'pending',
        orderId: targetOrderId,
        invoiceId: resolvedInvoiceId,
      })
    } catch (statusCheckError) {
      console.error('Error checking Gorekk status:', statusCheckError)
      return NextResponse.json({
        status: 'pending',
        orderId: orderId,
        invoiceId: resolvedInvoiceId,
      })
    }
  } catch (error) {
    console.error('Unexpected API error in /api/payments/gorekk GET:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
