import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'
import { formatCurrency } from '@/lib/utils'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getTransporter() {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null

  return require('nodemailer').createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass },
  })
}

// An invoice is meaningful once the order is actually confirmed — paid
// online, or COD (which has no separate online payment step; the order
// itself being created past 'pending' is the confirmation). This keeps
// a stranger from generating/emailing an invoice for an order that was
// never actually placed successfully.
function isInvoiceable(order: { payment_status: string; payment_method: string; status: string }): boolean {
  if (order.payment_status === 'paid') return true
  if (order.payment_method === 'cod' && order.status !== 'pending') return true
  return false
}

// formatCurrency() already returns a full "Rp150.000"-style string
// (Indonesian locale currency format) — every `Rp ${formatCurrency(...)}`
// call in the previous version of this file produced a doubled
// "Rp Rp150.000" on the invoice PDF and in the confirmation email.
// This helper is used everywhere a monetary value is rendered so that
// never happens again in either place.
function money(amount: number): string {
  return formatCurrency(amount || 0)
}

function buildInvoicePdf(order: any, items: any[], shopName: string): Buffer {
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const chunks: Buffer[] = []

  doc.on('data', (chunk: Buffer) => chunks.push(chunk))

  doc.fontSize(22).font('Helvetica-Bold').text('KOGRAPH STORE', { align: 'center' })
  doc.fontSize(11).font('Helvetica').text('Toko Online Terpercaya', { align: 'center' })
  doc.moveDown(0.8)

  doc.fontSize(18).font('Helvetica-Bold').text('INVOICE PEMBAYARAN', { align: 'center' })
  doc.moveDown(1)

  doc.fontSize(10).font('Helvetica')
  doc.text(`Nomor Pesanan : ${order.id}`)
  doc.text(`Tanggal       : ${new Date(order.created_at).toLocaleString('id-ID')}`)
  doc.text(`Status        : ${order.status.toUpperCase()}`)
  doc.text(`Pembayaran    : ${order.payment_method.toUpperCase()} - ${order.payment_status.toUpperCase()}`)
  doc.moveDown(1)

  doc.font('Helvetica-Bold').text('DETAIL PEMBELI')
  doc.font('Helvetica')
  const shipping = order.shipping_address || {}
  doc.text(`Nama  : ${shipping.full_name || order.user_id}`)
  doc.text(`Email : ${shipping.email || '-'}`)
  doc.text(`Telp  : ${shipping.phone || '-'}`)
  if (shipping.address) {
    doc.text(`Alamat: ${shipping.address}`)
    doc.text(`      ${shipping.city || ''}, ${shipping.postal_code || ''}`)
  }
  doc.moveDown(1)

  doc.font('Helvetica-Bold').text('DETAIL TOKO')
  doc.font('Helvetica')
  doc.text(`Toko  : ${shopName}`)
  doc.moveDown(1)

  doc.font('Helvetica-Bold').text('ITEM PESANAN')
  doc.moveDown(0.2)

  const col1 = 50
  const col2 = 310
  const col3 = 410
  const col4 = 500

  doc.font('Helvetica-Bold')
  doc.text('Produk', col1, doc.y)
  doc.text('Qty', col2, doc.y)
  doc.text('Harga', col3, doc.y)
  doc.text('Subtotal', col4, doc.y)
  doc.moveDown(0.5)

  doc.font('Helvetica')
  for (const item of items) {
    doc.text(item.product_name || 'Produk', col1, doc.y)
    doc.text(String(item.quantity), col2, doc.y)
    doc.text(money(item.price), col3, doc.y)
    doc.text(money(item.subtotal), col4, doc.y)
    doc.moveDown(0.4)
  }

  doc.moveDown(0.8)
  doc.font('Helvetica-Bold')
  doc.text('RINGKASAN', undefined, doc.y)
  doc.font('Helvetica')
  doc.moveDown(0.3)

  const summaryLeft = 50
  const summaryRight = 500

  doc.text('Subtotal     :', summaryLeft, doc.y)
  doc.text(money(order.subtotal), summaryRight, doc.y - 10)

  doc.text('Ongkir       :', summaryLeft, doc.y + 10)
  doc.text(money(order.shipping_cost), summaryRight, doc.y)

  doc.text('Pajak        :', summaryLeft, doc.y + 10)
  doc.text(money(order.tax_amount), summaryRight, doc.y)

  doc.text('Diskon       :', summaryLeft, doc.y + 10)
  doc.text(`-${money(order.discount_amount)}`, summaryRight, doc.y)

  doc.moveTo(50, doc.y + 12).lineTo(550, doc.y + 12).stroke()
  doc.moveDown(1)

  doc.font('Helvetica-Bold')
  doc.text('TOTAL        :', summaryLeft, doc.y)
  doc.text(money(order.total_amount), summaryRight, doc.y - 10)

  doc.moveDown(1.5)
  doc.fontSize(9).font('Helvetica')
  doc.text('Metode Pembayaran: ' + (order.payment_method === 'gorekk' ? 'Pembayaran Online (QRIS)' : 'COD'), { align: 'center' })
  doc.moveDown(0.5)
  doc.text('Terima kasih telah berbelanja!', { align: 'center' })

  doc.end()
  return Buffer.concat(chunks)
}

export async function GET(request: NextRequest) {
  try {
    const orderId = request.nextUrl.searchParams.get('order_id')
    if (!orderId) {
      return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!isInvoiceable(order as any)) {
      return NextResponse.json(
        { error: 'Invoice is only available once payment is confirmed', code: 'ORDER_NOT_CONFIRMED' },
        { status: 403 }
      )
    }

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)

    if (itemsError || !orderItems) {
      return NextResponse.json({ error: 'Order items not found' }, { status: 404 })
    }

    const { data: shop } = await supabase
      .from('shops')
      .select('name')
      .eq('id', (order as any).shop_id)
      .single()

    const pdfBuffer = buildInvoicePdf(order, orderItems, shop?.name || 'Kograph Store')

    return new NextResponse(Buffer.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${(order as any).id.slice(0, 8)}.pdf"`,
      },
    })
  } catch (error) {
    console.error('Error generating invoice:', error)
    return NextResponse.json({ error: 'Failed to generate invoice' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (!isInvoiceable(order as any)) {
      return NextResponse.json(
        { error: 'Invoice is only available once payment is confirmed', code: 'ORDER_NOT_CONFIRMED' },
        { status: 403 }
      )
    }

    // Idempotency — the payment webhook and the buyer landing on the
    // success page can each independently trigger this; without a
    // guard the buyer gets the same invoice emailed to them twice.
    if ((order as any).invoice_sent_at) {
      return NextResponse.json({ success: true, message: 'Invoice already sent' })
    }

    const transporter = getTransporter()
    if (!transporter) {
      console.warn('SMTP not configured, skipping invoice email')
      return NextResponse.json({ success: true, message: 'Invoice processed (SMTP not configured)' })
    }

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select('*')
      .eq('order_id', orderId)

    if (itemsError || !orderItems) {
      return NextResponse.json({ error: 'Order items not found' }, { status: 404 })
    }

    const { data: shop } = await supabase
      .from('shops')
      .select('name')
      .eq('id', (order as any).shop_id)
      .single()

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', (order as any).user_id)
      .single()

    const pdfBuffer = buildInvoicePdf(order, orderItems, shop?.name || 'Kograph Store')

    const shipping = (order as any).shipping_address || {}
    const customerEmail = profile?.email || shipping.email || ''
    const customerName = profile?.full_name || shipping.full_name || 'Customer'

    if (!customerEmail) {
      console.error(`No email on file for order ${orderId}`)
      return NextResponse.json({ error: 'Customer email not found' }, { status: 500 })
    }

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; text-align: center;">Pembayaran Berhasil!</h2>
          <p style="color: #666; font-size: 14px;">Halo <strong>${customerName}</strong>,</p>
          <p style="color: #666; font-size: 14px;">Pesanan Anda telah dikonfirmasi dan sedang diproses.</p>

          <div style="margin: 20px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">📋 Rincian Pesanan</h3>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Nomor:</strong> ${(order as any).id.slice(0, 8).toUpperCase()}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Toko:</strong> ${shop?.name || '-'}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Total:</strong> ${money((order as any).total_amount)}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Pembayaran:</strong> ${(order as any).payment_method.toUpperCase()} - ${(order as any).payment_status.toUpperCase()}</p>
          </div>

          <p style="color: #666; font-size: 14px;">Invoice terlampir dalam format PDF.</p>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">© 2025 Kograph Store</p>
        </div>
      </div>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: customerEmail,
      subject: `Invoice Pembayaran - ${(order as any).id.slice(0, 8).toUpperCase()}`,
      html: emailHtml,
      attachments: [
        {
          filename: `Invoice-${(order as any).id.slice(0, 8)}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    await supabase
      .from('orders')
      .update({ invoice_sent_at: new Date().toISOString() })
      .eq('id', orderId)

    return NextResponse.json({ success: true, message: 'Invoice sent' })
  } catch (error) {
    console.error('Error sending invoice email:', error)
    return NextResponse.json({ error: 'Failed to send invoice email' }, { status: 500 })
  }
}
