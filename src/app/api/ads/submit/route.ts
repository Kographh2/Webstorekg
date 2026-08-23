import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Very small first-pass triage list for obviously prohibited ad
 * content (online gambling being the most explicit legal risk in the
 * Indonesian market). This is a keyword check, NOT real content
 * moderation — it exists only to flag likely-prohibited submissions
 * for priority attention in the owner's review queue. A clean scan
 * here is not an approval, and a flagged one is not an automatic
 * rejection: the owner always makes the actual call in
 * owner_review_ad().
 */
const PROHIBITED_KEYWORDS = [
  'judi', 'slot gacor', 'slot online', 'togel', 'toto gelap', 'taruhan',
  'poker online', 'domino qq', 'casino online', 'kasino online',
  'situs gacor', 'maxwin', 'rtp slot', 'bandar bola', 'sabung ayam',
]

function checkProhibitedContent(title: string, description: string): string | null {
  const text = `${title} ${description}`.toLowerCase()
  const matched = PROHIBITED_KEYWORDS.find((keyword) => text.includes(keyword))
  return matched ? `Mengandung kata kunci terlarang: "${matched}"` : null
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined
    if (!token) {
      return NextResponse.json({ error: 'Sesi tidak ditemukan. Silakan masuk ulang.' }, { status: 401 })
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Sesi tidak valid. Silakan masuk ulang.' }, { status: 401 })
    }
    const userId = authData.user.id

    const body = await request.json()
    const { shopId, productId, targetUrl, imageUrl, title, description, pricePaid, durationDays } = body

    if (!shopId || !targetUrl || !imageUrl || !title || !description) {
      return NextResponse.json({ error: 'Lengkapi semua field yang wajib diisi', code: 'INVALID_REQUEST' }, { status: 400 })
    }
    if (title.length > 100) {
      return NextResponse.json({ error: 'Judul maksimal 100 karakter', code: 'INVALID_REQUEST' }, { status: 400 })
    }
    if (description.length > 500) {
      return NextResponse.json({ error: 'Deskripsi maksimal 500 karakter', code: 'INVALID_REQUEST' }, { status: 400 })
    }

    // Verify the caller actually owns this shop.
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .select('id, owner_id, banned_until')
      .eq('id', shopId)
      .single()

    if (shopError || !shop) {
      return NextResponse.json({ error: 'Toko tidak ditemukan', code: 'SHOP_NOT_FOUND' }, { status: 404 })
    }
    if ((shop as any).owner_id !== userId) {
      return NextResponse.json({ error: 'Anda bukan pemilik toko ini', code: 'FORBIDDEN' }, { status: 403 })
    }
    if ((shop as any).banned_until && new Date((shop as any).banned_until) > new Date()) {
      return NextResponse.json({ error: 'Toko sedang dalam masa banned dan tidak dapat membeli iklan', code: 'SHOP_BANNED' }, { status: 403 })
    }

    const flagReason = checkProhibitedContent(title, description)

    const { data: ad, error: insertError } = await supabase
      .from('ads')
      .insert({
        shop_id: shopId,
        submitted_by: userId,
        product_id: productId || null,
        target_url: targetUrl,
        image_url: imageUrl,
        title,
        description,
        price_paid: pricePaid || 0,
        auto_flagged: !!flagReason,
        flag_reason: flagReason,
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    return NextResponse.json({
      success: true,
      adId: (ad as any).id,
      message: flagReason
        ? 'Iklan diterima dan sedang ditinjau (butuh waktu lebih lama karena terdeteksi memerlukan pengecekan ekstra)'
        : 'Iklan berhasil diajukan dan akan ditinjau dalam 24 jam',
    })
  } catch (error) {
    console.error('Error submitting ad:', error)
    return NextResponse.json({ error: 'Gagal mengajukan iklan', code: 'INTERNAL_ERROR' }, { status: 500 })
  }
}
