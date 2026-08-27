import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function mapNotificationToStatus(rawStatus: string): 'pending' | 'paid' | 'failed' | 'expired' {
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

    const rawStatus = String(notification.status || '')
    const gorekkStatus = mapNotificationToStatus(rawStatus)

    console.log('Gorekk notification status mapping:', { rawStatus, gorekkStatus, invoiceId, orderId })

    if (gorekkStatus === 'pending') {
      console.log('Gorekk notification status is pending, ignoring')
      return NextResponse.json({ success: true })
    }

    let orderData = null
    let fetchError = null

    if (invoiceId) {
      const result = await supabase
        .from('orders')
        .select('id, status, payment_status, user_id, total_amount, transaction_id')
        .eq('transaction_id', invoiceId)
        .single()
      orderData = result.data
      fetchError = result.error
    }

    if (!orderData && orderId) {
      const result = await supabase
        .from('orders')
        .select('id, status, payment_status, user_id, total_amount, transaction_id')
        .eq('id', orderId)
        .single()
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

    if (order.payment_status === 'paid' && gorekkStatus !== 'paid') {
      console.log(`Order ${order.id} already paid, ignoring duplicate notification`)
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
