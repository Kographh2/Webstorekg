import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getTransporter() {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    return null
  }

  return require('nodemailer').createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass },
  })
}

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json()
    if (!orderId) {
      return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
    }

    // Order itself is fetched plain, then buyer profile and shop are
    // fetched separately below — `orders` has no `user`/`shop` foreign
    // key embed target under those exact names, so `.select('*')`
    // alone (as this used to do) left `order.user` / `order.shop`
    // undefined and crashed on `.full_name` / `.name` access further
    // down. Fetching them explicitly avoids relying on an embed that
    // was never actually there.
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // SECURITY: digital files are the actual paid product. Without
    // this check, anyone who creates an order (which exists in the
    // database immediately on checkout, before payment completes) could
    // call this endpoint directly with their own orderId and receive
    // the real paid file for free before ever paying.
    if ((order as any).payment_status !== 'paid') {
      return NextResponse.json(
        { error: 'Order has not been paid yet', code: 'ORDER_NOT_PAID' },
        { status: 403 }
      )
    }

    // Idempotency: don't re-send (and re-download from Storage) on
    // every retry/duplicate trigger — both the payment webhook and the
    // success page independently try to trigger this once payment
    // clears.
    if ((order as any).digital_delivered_at) {
      return NextResponse.json({ success: true, message: 'Digital products already delivered' })
    }

    const [{ data: buyer }, { data: shop }, { data: orderItems, error: itemsError }] = await Promise.all([
      supabase.from('profiles').select('email, full_name').eq('id', (order as any).user_id).single(),
      supabase.from('shops').select('name').eq('id', (order as any).shop_id).single(),
      supabase
        .from('order_items')
        .select(`
          *,
          product:products(
            id,
            name,
            product_type,
            digital_delivery_content
          )
        `)
        .eq('order_id', orderId),
    ])

    if (itemsError || !orderItems) {
      return NextResponse.json({ error: 'Order items not found' }, { status: 404 })
    }

    const digitalProducts = orderItems.filter(
      (item: any) => item.product?.product_type === 'digital' || item.product?.digital_delivery_content
    )

    if (digitalProducts.length === 0) {
      return NextResponse.json({
        message: 'No digital products in this order',
      })
    }

    const transporter = getTransporter()
    if (!transporter) {
      console.warn('SMTP not configured, skipping digital products email')
      return NextResponse.json({
        success: true,
        message: 'Digital products processed (SMTP not configured)',
      })
    }

    const buyerEmail = buyer?.email
    const buyerName = buyer?.full_name || 'Customer'
    if (!buyerEmail) {
      console.error(`No email on file for order ${orderId}'s buyer`)
      return NextResponse.json({ error: 'Buyer email not found' }, { status: 500 })
    }

    const emailAttachments: any[] = []

    for (const item of digitalProducts) {
      const product = item.product as any
      const filePath = product.digital_delivery_content

      if (!filePath) continue

      const { data: fileData, error: downloadError } = await supabase.storage
        .from('digital-products')
        .download(filePath)

      if (downloadError || !fileData) {
        console.error(`Failed to download digital file ${filePath}:`, downloadError)
        continue
      }

      const arrayBuffer = await fileData.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      emailAttachments.push({
        filename: product.name || 'digital-product',
        content: buffer,
        contentType: 'application/octet-stream',
      })
    }

    if (emailAttachments.length === 0) {
      console.error(`Order ${orderId} has digital items but no files could be downloaded`)
      return NextResponse.json({ error: 'Failed to retrieve digital product files' }, { status: 500 })
    }

    const digitalListHtml = digitalProducts
      .map((item: any) => {
        const product = item.product as any
        return `<li style="margin: 6px 0;"><strong>${product.name}</strong> - terlampir di email ini</li>`
      })
      .join('')

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="background-color: white; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; text-align: center;">Pesanan Digital Anda</h2>
          <p style="color: #666; font-size: 14px;">Halo <strong>${buyerName}</strong>,</p>
          <p style="color: #666; font-size: 14px;">Terima kasih telah membeli produk digital kami. File produk Anda terlampir di email ini.</p>

          <div style="margin: 20px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">📦 Produk Digital:</h3>
            <ul style="color: #666; font-size: 14px; padding-left: 20px;">
              ${digitalListHtml}
            </ul>
          </div>

          <div style="margin: 20px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">📋 Rincian Pesanan:</h3>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Nomor Pesanan:</strong> ${orderId.slice(0, 8).toUpperCase()}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Toko:</strong> ${shop?.name || '-'}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Total:</strong> ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format((order as any).total_amount)}</p>
          </div>

          <p style="color: #666; font-size: 14px;">Simpan invoice ini sebagai bukti pembelian. Jika Anda memiliki pertanyaan, hubungi support@kographstore.com.</p>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">© 2025 Kograph Store</p>
        </div>
      </div>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: buyerEmail,
      subject: `Produk Digital Anda - ${orderId.slice(0, 8).toUpperCase()}`,
      html: emailHtml,
      attachments: emailAttachments,
    })

    await supabase
      .from('orders')
      .update({ digital_delivered_at: new Date().toISOString() })
      .eq('id', orderId)

    return NextResponse.json({
      success: true,
      message: 'Digital products sent via email',
    })
  } catch (error) {
    console.error('Error sending digital products:', error)
    return NextResponse.json({ error: 'Failed to send digital products' }, { status: 500 })
  }
}
