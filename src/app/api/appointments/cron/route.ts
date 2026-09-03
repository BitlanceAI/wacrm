import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send'
import { remindersActiveForStatus } from '@/lib/appointments/scheduling'

/**
 * Appointment reminder sweep.
 *
 * Sends every pending reminder whose `send_at` has passed. Mirrors the
 * auth and hosting conventions of /api/flows/cron — same
 * AUTOMATION_CRON_SECRET so operators provision one secret, separate
 * URL so one sweep failing doesn't take the others down.
 *
 * Run it at least as often as your tightest reminder lead time. With
 * the 15-minute preset, a 5-minute schedule keeps drift under a
 * quarter of the window.
 */

export const maxDuration = 60

/** Never send a reminder for a booking this far in the past. */
const STALE_AFTER_MINUTES = 120

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const now = new Date()
  const staleCutoff = new Date(now.getTime() - STALE_AFTER_MINUTES * 60_000)

  const { data: due, error } = await admin
    .from('appointment_reminders')
    .select(
      'id, user_id, appointment_id, send_at, channel, message_text, template_name, template_language, template_params, appointments!inner(id, contact_id, conversation_id, status, starts_at)'
    )
    .eq('status', 'pending')
    .is('claimed_at', null)
    .lte('send_at', now.toISOString())
    .order('send_at', { ascending: true })
    .limit(200)

  if (error) {
    console.error('[appointments/cron] fetch failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const reminder of due ?? []) {
    // Supabase types the embedded row as an array; it's a to-one join.
    const appointment = (
      Array.isArray(reminder.appointments)
        ? reminder.appointments[0]
        : reminder.appointments
    ) as {
      id: string
      contact_id: string
      conversation_id: string | null
      status: string
      starts_at: string
    }

    // Claim first. Two overlapping ticks would otherwise both pick this
    // row up and the customer would get the same nudge twice.
    const { data: claimed } = await admin
      .from('appointment_reminders')
      .update({ claimed_at: now.toISOString() })
      .eq('id', reminder.id)
      .is('claimed_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) {
      skipped++
      continue
    }

    // A booking cancelled between scheduling and sending, or one whose
    // reminder is so late that the appointment has already been and
    // gone — neither is worth messaging about.
    const tooLate = new Date(reminder.send_at) < staleCutoff
    if (!remindersActiveForStatus(appointment.status) || tooLate) {
      await admin
        .from('appointment_reminders')
        .update({
          status: 'skipped',
          error_message: tooLate
            ? 'Reminder was overdue by more than two hours'
            : `Appointment status is ${appointment.status}`,
        })
        .eq('id', reminder.id)
      skipped++
      continue
    }

    // A reminder needs a conversation to post into. Bookings made
    // against a contact who has never messaged won't have one.
    let conversationId = appointment.conversation_id
    if (!conversationId) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('user_id', reminder.user_id)
        .eq('contact_id', appointment.contact_id)
        .maybeSingle()
      conversationId = conv?.id ?? null
    }
    if (!conversationId) {
      await admin
        .from('appointment_reminders')
        .update({
          status: 'failed',
          error_message:
            'No conversation with this contact — they must message you first, or the reminder must use a template.',
        })
        .eq('id', reminder.id)
      failed++
      continue
    }

    try {
      if (reminder.channel === 'template' && reminder.template_name) {
        await engineSendTemplate({
          userId: reminder.user_id,
          conversationId,
          contactId: appointment.contact_id,
          templateName: reminder.template_name,
          language: reminder.template_language ?? 'en_US',
          params: Array.isArray(reminder.template_params)
            ? (reminder.template_params as string[])
            : [],
        })
      } else {
        await engineSendText({
          userId: reminder.user_id,
          conversationId,
          contactId: appointment.contact_id,
          text: reminder.message_text ?? 'Reminder for your upcoming appointment.',
        })
      }

      await admin
        .from('appointment_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', reminder.id)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Terminal, not retried: the most common cause is the 24-hour
      // window having closed, which will still be true next tick. The
      // error text tells the operator to switch the reminder to a
      // template rather than leaving them to guess.
      await admin
        .from('appointment_reminders')
        .update({ status: 'failed', error_message: message })
        .eq('id', reminder.id)
      console.error(`[appointments/cron] reminder ${reminder.id} failed:`, message)
      failed++
    }
  }

  console.log(
    `[appointments/cron] due=${(due ?? []).length} sent=${sent} skipped=${skipped} failed=${failed}`
  )
  return NextResponse.json({
    due: (due ?? []).length,
    sent,
    skipped,
    failed,
  })
}
