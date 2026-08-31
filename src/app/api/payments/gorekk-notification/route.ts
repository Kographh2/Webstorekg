import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGorekkInvoiceStatus, GorekkApiError } from '@/lib/gorekk'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function findOrderByInvoiceId(invoiceId: string) {
  return supabase
    .from('orders')
    .select('id, status, payment_status, user_id, total_amount, transaction_id, payment_method, shipping_address')
    .eq('transaction_id', invoiceId)
    .single()
}

async function findOrderByOrderId(orderId: string) {
  return supabase
    .from('orders')
    .select('id, status, payment_status, user_id, total_amount, transaction_id, payment_method, shipping_address')
    .eq('id', orderId)
    .single()
}

async function sendInvoiceEmail(order: any) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`Failed to send invoice email for ${order.id}:`, err)
    }
  } catch (err) {
    console.error('Error calling invoice email API:', err)
  }
}

async function sendDigitalProductsEmail(order: any) {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/products/send-digital`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`Failed to send digital products email for ${order.id}:`, err)
    }
  } catch (err) {
    console.error('Error calling digital products email API:', err)
  }
}

function mapGorekkStatus(rawStatus: string): 'pending' | 'paid' | 'failed' | 'expired' {
  const status = String(rawStatus || '').toLowerCase()

  if (status === 'paid' || status === 'success' || status === 'settlement' || status === 'capture') {
    return 'paid'
  }
  if (status === 'failed' || status === 'deny' || status === 'cancel') {
    return 'failed'
  }
  if (status === 'expired' || status === 'expire') {
    return 'expired'
  }
  return 'pending'
}

export async function POST(request: NextRequest) {
  try {
    const notification = await request.json() as Record<string, unknown>

    console.log('Gorekk notification received:', JSON.stringify(notification))

    const invoiceId = String(notification.invoice_id || '')
    const orderId = String(notification.order_id || '')

    if (!invoiceId && !orderId) {
      console.warn('Gorekk notification missing invoice_id/order_id')
      return NextResponse.json({ error: 'Invalid notification' }, { status: 400 })
    }

    let orderData = null
    let fetchError = null

    if (invoiceId) {
      const result = await findOrderByInvoiceId(invoiceId)
      orderData = result.data
      fetchError = result.error
    }

    if (!orderData && orderId) {
      const result = await findOrderByOrderId(orderId)
      orderData = result.data
      fetchError = result.error
    }

    if (fetchError || !orderData) {
      console.error('Order not found for invoice/order:', { invoiceId, orderId })
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = orderData as unknown as {
      id: string
      status: string
      payment_status: string
      user_id: string
      total_amount: number
      transaction_id: string | null
      payment_method: string
      shipping_address: any
    }

    // SECURITY: this endpoint is a public URL Gorekk calls, so its
    // request body can't be trusted on its own — anyone who guesses or
    // learns an order_id could otherwise POST a forged
    // `{"order_id": "...", "status": "paid"}` here and mark an unpaid
    // order paid for free (there was previously no verification at
    // all). Instead of trusting `notification.status`, we ask Gorekk's
    // own status API for the ground truth using OUR authenticated API
    // key, and only ever act on what that authenticated call reports.
    const invoiceToVerify = order.transaction_id || invoiceId
    if (!invoiceToVerify) {
      console.error(`No transaction_id to verify for order ${order.id}`)
      return NextResponse.json({ error: 'No invoice to verify' }, { status: 400 })
    }

    let gorekkStatus: 'pending' | 'paid' | 'failed' | 'expired'
    try {
      const verified = await getGorekkInvoiceStatus(invoiceToVerify)
      gorekkStatus = mapGorekkStatus(verified.status)
    } catch (verifyError) {
      // If Gorekk's status API itself is unreachable/erroring, we do
      // NOT fall back to trusting the notification body — that would
      // defeat the whole point of verifying. The regular status
      // polling (GET /api/payments/gorekk) will pick this order up on
      // its own schedule instead.
      console.error(`Failed to verify Gorekk status for order ${order.id}:`, verifyError)
      const code = verifyError instanceof GorekkApiError ? verifyError.code : 'VERIFY_FAILED'
      return NextResponse.json({ error: 'Could not verify payment status', code }, { status: 502 })
    }

    console.log('Gorekk notification verified status:', { invoiceId: invoiceToVerify, gorekkStatus })

    if (gorekkStatus === 'pending') {
      return NextResponse.json({ success: true })
    }

    if (order.payment_status === 'paid' && gorekkStatus !== 'paid') {
      console.log(`Order ${order.id} already paid, ignoring conflicting notification`)
      return NextResponse.json({ success: true })
    }

    if (order.payment_status === gorekkStatus) {
      console.log(`Order ${order.id} already in status ${gorekkStatus}, idempotent skip`)
      return NextResponse.json({ success: true })
    }

    const updatePayload: Record<string, unknown> = {
      payment_status: gorekkStatus,
      payment_confirmed_at: gorekkStatus === 'paid' ? new Date().toISOString() : null,
    }

    if (gorekkStatus === 'paid') {
      updatePayload.status = 'paid'
    } else if (gorekkStatus === 'failed' || gorekkStatus === 'expired') {
      updatePayload.status = 'cancelled'
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id)

    if (updateError) {
      console.error('Error updating order:', updateError)
      return NextResponse.json(
        { error: 'Failed to update order' },
        { status: 500 }
      )
    }

    try {
      await supabase
        .from('payment_notifications')
        .insert({
          order_id: order.id,
          transaction_id: invoiceToVerify,
          status: gorekkStatus,
          response_data: notification,
        })
    } catch (err) {
      console.error('Error logging notification:', err)
    }

    console.log(`Order ${order.id} payment_status -> ${gorekkStatus}`)

    if (gorekkStatus === 'paid') {
      sendInvoiceEmail(order)
      sendDigitalProductsEmail(order)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Notification handler error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Gorekk notification endpoint is ready',
  })
}
