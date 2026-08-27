import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getGorekkInvoiceStatus, GorekkApiError } from '@/lib/gorekk'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const notification = await request.json() as Record<string, unknown>

    const invoiceId = String(notification.invoice_id || notification.order_id || '')

    if (!invoiceId) {
      console.warn('Gorekk notification missing invoice_id')
      return NextResponse.json({ error: 'Invalid notification' }, { status: 400 })
    }

    const { data: orderData, error: fetchError } = await supabase
      .from('orders')
      .select('id, status, payment_status, user_id, total_amount')
      .eq('transaction_id', invoiceId)
      .single()

    if (fetchError || !orderData) {
      console.error('Order not found for invoice:', invoiceId)
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = orderData as unknown as {
      id: string
      status: string
      payment_status: string
      user_id: string
      total_amount: number
    }

    let gorekkStatus: 'pending' | 'paid' | 'failed' | 'expired' = 'pending'

    try {
      const statusData = await getGorekkInvoiceStatus(invoiceId)
      const rawStatus = statusData.status.toLowerCase()

      if (rawStatus === 'paid') {
        gorekkStatus = 'paid'
      } else if (rawStatus === 'failed' || rawStatus === 'expired') {
        gorekkStatus = rawStatus
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
          transaction_id: invoiceId,
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
