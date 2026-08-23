import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Runs hourly (see vercel.json). Flags any ad submission still
 * 'pending' after its 24-hour review_deadline so it surfaces at the
 * top of the owner's review queue — this is what "dalam 24 jam sistem
 * akan mengecek" maps to concretely.
 *
 * IMPORTANT HONEST LIMITATION: this does NOT do real content
 * moderation (no image analysis, no judgment about gambling/scam
 * content). Genuinely detecting prohibited ad content requires either
 * a human reviewer or a real moderation AI/service — this cron only
 * makes sure an overdue submission can't silently sit forever without
 * anyone noticing. A lightweight keyword check for obviously
 * prohibited terms runs separately at submission time (see
 * /api/ads/submit) as a first-pass triage helper, not a final
 * decision — the owner always makes the actual approve/reject call.
 */
export async function GET(request: NextRequest) {
  // Vercel sets this header on its own cron invocations. If CRON_SECRET
  // is configured, require it so this endpoint can't be triggered by
  // an outsider hitting the URL directly.
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const { data: overdueAds, error } = await supabase
      .from('ads')
      .select('id')
      .eq('status', 'pending')
      .eq('auto_flagged', false)
      .lt('review_deadline', new Date().toISOString())

    if (error) throw error

    if (!overdueAds || overdueAds.length === 0) {
      return NextResponse.json({ flagged: 0 })
    }

    const ids = overdueAds.map((a: { id: string }) => a.id)
    const { error: updateError } = await supabase
      .from('ads')
      .update({
        auto_flagged: true,
        flag_reason: 'Melewati batas waktu review 24 jam — perlu ditinjau segera',
      })
      .in('id', ids)

    if (updateError) throw updateError

    return NextResponse.json({ flagged: ids.length })
  } catch (error) {
    console.error('Error in check-ads cron:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
