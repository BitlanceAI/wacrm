import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { planReminders, defaultReminderText } from '@/lib/appointments/scheduling'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Appointments collection endpoint.
 *
 * Reminder rows are created here rather than in the client so that a
 * booking and its nudges are decided in one place — a client that
 * forgot to post reminders would produce a booking nobody is ever
 * reminded about, and the failure would be silent.
 */

interface CreateBody {
  contact_id: string
  title: string
  starts_at: string
  ends_at?: string | null
  timezone?: string
  notes?: string | null
  location?: string | null
  conversation_id?: string | null
  /** Lead times in minutes. Omit for no reminders. */
  reminder_offsets?: number[]
  /** Optional approved template to use instead of free text. */
  reminder_template_name?: string | null
  reminder_template_language?: string | null
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = await resolveTenantUserId(supabase, user.id)

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const contactId = searchParams.get('contact_id')
  // Default view is "what's coming up", not the full history — a desk
  // with two years of bookings shouldn't pay for all of them on load.
  const from = searchParams.get('from') ?? new Date().toISOString()

  let query = supabase
    .from('appointments')
    .select('*, contact:contacts(id, name, phone)')
    .order('starts_at', { ascending: true })
    .limit(200)

  if (status) query = query.eq('status', status)
  if (contactId) query = query.eq('contact_id', contactId)
  if (from !== 'all') query = query.gte('starts_at', from)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ appointments: data ?? [] })
}

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

    const tenantId = await resolveTenantUserId(supabase, user.id)

    const limit = checkRateLimit(`appointments:${tenantId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json()) as CreateBody
    if (!body.contact_id || !body.title?.trim() || !body.starts_at) {
      return NextResponse.json(
        { error: 'contact_id, title and starts_at are required' },
        { status: 400 }
      )
    }
    if (Number.isNaN(new Date(body.starts_at).getTime())) {
      return NextResponse.json(
        { error: 'starts_at must be a valid timestamp' },
        { status: 400 }
      )
    }

    // Contact lookup doubles as the ownership check (RLS) and supplies
    // the name for the default reminder text.
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('id', body.contact_id)
      .maybeSingle()
    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const timezone = body.timezone?.trim() || 'Asia/Kolkata'

    const { data: appointment, error: insertError } = await supabase
      .from('appointments')
      .insert({
        user_id: tenantId,
        contact_id: body.contact_id,
        conversation_id: body.conversation_id ?? null,
        title: body.title.trim(),
        notes: body.notes ?? null,
        location: body.location ?? null,
        starts_at: body.starts_at,
        ends_at: body.ends_at ?? null,
        timezone,
      })
      .select()
      .single()
    if (insertError || !appointment) {
      return NextResponse.json(
        { error: `Failed to create appointment: ${insertError?.message}` },
        { status: 500 }
      )
    }

    const planned = planReminders(body.starts_at, body.reminder_offsets ?? [])
    let remindersCreated = 0

    if (planned.length > 0) {
      const useTemplate = Boolean(body.reminder_template_name)
      const rows = planned.map((p) => ({
        appointment_id: appointment.id,
        user_id: tenantId,
        send_at: p.send_at,
        offset_minutes: p.offset_minutes,
        channel: useTemplate ? 'template' : 'text',
        message_text: useTemplate
          ? null
          : defaultReminderText({
              contactName: contact.name,
              title: appointment.title,
              startsAtIso: appointment.starts_at,
              timeZone: timezone,
              location: appointment.location,
            }),
        template_name: body.reminder_template_name ?? null,
        template_language: body.reminder_template_language ?? 'en_US',
      }))

      const { error: reminderError } = await supabase
        .from('appointment_reminders')
        .insert(rows)
      if (reminderError) {
        // The booking itself is valid and worth keeping; say plainly
        // that the nudges didn't get scheduled rather than pretending
        // the whole thing succeeded.
        console.error('[appointments] reminder insert failed:', reminderError.message)
        return NextResponse.json(
          {
            appointment,
            reminders_created: 0,
            warning: `Appointment saved, but reminders could not be scheduled: ${reminderError.message}`,
          },
          { status: 207 }
        )
      }
      remindersCreated = rows.length
    }

    const skipped = (body.reminder_offsets ?? []).length - remindersCreated
    return NextResponse.json({
      appointment,
      reminders_created: remindersCreated,
      // Surfaced so the UI can say "the 24h reminder was skipped — the
      // booking is sooner than that" instead of quietly dropping it.
      reminders_skipped_as_past: Math.max(0, skipped),
    })
  } catch (error) {
    console.error('[appointments] unhandled exception:', error)
    return NextResponse.json(
      { error: 'Failed to create appointment' },
      { status: 500 }
    )
  }
}
