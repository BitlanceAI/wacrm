import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendInteractiveList } from '@/lib/flows/meta-send'
import { csatSections } from '@/lib/support/csat'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Send the post-resolution CSAT survey for one conversation.
 *
 * Called by the inbox when an agent closes a thread. Kept server-side
 * rather than sent straight from the browser because it needs the
 * decrypted WhatsApp token — and because the "have we already surveyed
 * this thread" check must not be something a client can skip.
 *
 * Returns 200 with `sent: false` for every "nothing to do" case
 * (feature off, survey already pending, thread not closed). Those are
 * normal outcomes of closing a conversation, not errors, and surfacing
 * them as failures would put a red toast in front of an agent who did
 * nothing wrong.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(`csat:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversation_id } = await request.json()
    if (!conversation_id) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      )
    }

    // RLS scopes this to the caller, so a conversation id belonging to
    // another account simply doesn't resolve.
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, status')
      .eq('id', conversation_id)
      .maybeSingle()
    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }
    if (conversation.status !== 'closed') {
      return NextResponse.json({ sent: false, reason: 'not_closed' })
    }

    const { data: settings } = await supabase
      .from('inbox_settings')
      .select('csat_enabled, csat_question')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!settings?.csat_enabled) {
      return NextResponse.json({ sent: false, reason: 'disabled' })
    }

    // One survey per resolution. The partial unique index enforces this
    // at the DB level too — this check just avoids a pointless send.
    const { data: pending } = await supabase
      .from('csat_responses')
      .select('id')
      .eq('conversation_id', conversation_id)
      .is('responded_at', null)
      .maybeSingle()
    if (pending) {
      return NextResponse.json({ sent: false, reason: 'already_pending' })
    }

    // Insert BEFORE sending: if the send fails we can retry, whereas a
    // survey the customer received but we never recorded would silently
    // drop their score when they answer it.
    const admin = supabaseAdmin()
    const { data: row, error: insertError } = await admin
      .from('csat_responses')
      .insert({
        user_id: user.id,
        conversation_id,
        contact_id: conversation.contact_id,
      })
      .select('id')
      .single()
    if (insertError || !row) {
      return NextResponse.json(
        { error: `Failed to record survey: ${insertError?.message}` },
        { status: 500 }
      )
    }

    try {
      await engineSendInteractiveList({
        userId: user.id,
        conversationId: conversation_id,
        contactId: conversation.contact_id,
        bodyText: settings.csat_question,
        buttonLabel: 'Rate us',
        sections: csatSections(),
      })
    } catch (sendError) {
      // Roll the placeholder back so the next close can try again —
      // otherwise the pending-survey check above blocks this thread
      // from ever being surveyed.
      await admin.from('csat_responses').delete().eq('id', row.id)
      const message =
        sendError instanceof Error ? sendError.message : 'Unknown error'
      console.error('[csat] survey send failed:', message)
      return NextResponse.json(
        { sent: false, reason: 'send_failed', error: message },
        { status: 502 }
      )
    }

    return NextResponse.json({ sent: true, id: row.id })
  } catch (error) {
    console.error('[csat] unhandled exception:', error)
    return NextResponse.json({ error: 'Failed to send survey' }, { status: 500 })
  }
}
