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
    .select('id, status, payment_status, user_id, total_amount, transaction_id')
    .eq('transaction_id', invoiceId)
    .single()
}

async function findOrderByOrderId(orderId: string) {
  return supabase
    .from('orders')
    .select('id, status, payment_status, user_id, total_amount, transaction_id')
    .eq('id', orderId)
    .single()
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
    }

    let gorekkStatus: 'pending' | 'paid' | 'failed' | 'expired' = 'pending'

    try {
      const statusData = await getGorekkInvoiceStatus(invoiceId || order.transaction_id || '')
      const rawStatus = String(statusData?.status || 'pending').toLowerCase()

      if (rawStatus === 'paid' || rawStatus === 'success' || rawStatus === 'settlement' || rawStatus === 'capture') {
        gorekkStatus = 'paid'
      } else if (rawStatus === 'failed' || rawStatus === 'deny' || rawStatus === 'cancel') {
        gorekkStatus = 'failed'
      } else if (rawStatus === 'expired' || rawStatus === 'expire') {
        gorekkStatus = 'expired'
      }
    } catch (err) {
      console.error('Error verifying Gorekk invoice status:', err)
      return NextResponse.json(
        { error: 'Failed to verify payment status' },
        { status: 502 }
      )
    }

    if (order.payment_status === 'paid' && gorekkStatus !== 'paid') {
      console.log(`Order ${order.id} already paid, ignoring duplicate notification`)
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
          transaction_id: invoiceId || order.transaction_id || '',
          status: gorekkStatus,
          response_data: notification,
        })
    } catch (err) {
      console.error('Error logging notification:', err)
    }

    console.log(`Order ${order.id} payment_status -> ${gorekkStatus}`)
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
