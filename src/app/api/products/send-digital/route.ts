import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { formatCurrency } from '@/lib/utils'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getTransporter() {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD

  if (!host || !user || !pass) {
    return null
  }

  return require('nodemailer').createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
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

    const { data: orderItems, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        *,
        product:products(
          id,
          name,
          product_type,
          digital_delivery_content,
          digital_file_path
        )
      `)
      .eq('order_id', orderId)

    if (itemsError || !orderItems) {
      return NextResponse.json({ error: 'Order items not found' }, { status: 404 })
    }

    const digitalProducts = orderItems.filter(
      (item: any) => item.product?.product_type === 'digital' || item.product?.digital_delivery_content || item.product?.digital_file_path
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

    const emailAttachments: any[] = []

    for (const item of digitalProducts) {
      const product = item.product as any
      const filePath = product.digital_file_path || product.digital_delivery_content

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
          <p style="color: #666; font-size: 14px;">Halo <strong>${order.user.full_name}</strong>,</p>
          <p style="color: #666; font-size: 14px;">Terima kasih telah membeli produk digital kami. File produk Anda terlampir di email ini.</p>

          <div style="margin: 20px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">📦 Produk Digital:</h3>
            <ul style="color: #666; font-size: 14px; padding-left: 20px;">
              ${digitalListHtml}
            </ul>
          </div>

          <div style="margin: 20px 0; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
            <h3 style="color: #333; margin-top: 0;">📋 Rincian Pesanan:</h3>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Nomor Pesanan:</strong> ${order.id.slice(0, 8).toUpperCase()}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Toko:</strong> ${order.shop.name}</p>
            <p style="color: #666; font-size: 14px; margin: 6px 0;"><strong>Total:</strong> Rp ${formatCurrency(order.total_amount)}</p>
          </div>

          <p style="color: #666; font-size: 14px;">Simpan invoice ini sebagai bukti pembelian. Jika Anda memiliki pertanyaan, hubungi support@kographstore.com.</p>
          <p style="color: #999; font-size: 12px; text-align: center; margin-top: 20px;">© 2025 Kograph Store</p>
        </div>
      </div>
    `

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: order.user.email,
      subject: `Produk Digital Anda - ${order.id.slice(0, 8).toUpperCase()}`,
      html: emailHtml,
      attachments: emailAttachments,
    })

    return NextResponse.json({
      success: true,
      message: 'Digital products sent via email',
    })
  } catch (error) {
    console.error('Error sending digital products:', error)
    return NextResponse.json({ error: 'Failed to send digital products' }, { status: 500 })
  }
}
