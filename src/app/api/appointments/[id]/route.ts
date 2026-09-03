import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { planReminders, defaultReminderText } from '@/lib/appointments/scheduling'

/**
 * Single appointment: update (including reschedule) and delete.
 *
 * Rescheduling is the interesting case. Moving `starts_at` must move
 * the pending reminders with it — a booking pushed to next week whose
 * reminders still fire tomorrow is worse than no reminders at all.
 * Already-sent reminders are left untouched: they are history, and
 * rewriting them would make "did we remind them?" unanswerable.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()

    const { data: existing, error: findError } = await supabase
      .from('appointments')
      .select('*, contact:contacts(id, name)')
      .eq('id', id)
      .maybeSingle()
    if (findError || !existing) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const field of [
      'title',
      'notes',
      'location',
      'starts_at',
      'ends_at',
      'timezone',
      'status',
    ] as const) {
      if (body[field] !== undefined) patch[field] = body[field]
    }

    if (
      typeof patch.starts_at === 'string' &&
      Number.isNaN(new Date(patch.starts_at).getTime())
    ) {
      return NextResponse.json(
        { error: 'starts_at must be a valid timestamp' },
        { status: 400 }
      )
    }

    const { data: updated, error: updateError } = await supabase
      .from('appointments')
      .update(patch)
      .eq('id', id)
      .select()
      .single()
    if (updateError || !updated) {
      return NextResponse.json(
        { error: `Failed to update appointment: ${updateError?.message}` },
        { status: 500 }
      )
    }

    // Reschedule: rebuild the pending nudges around the new time.
    let remindersRescheduled = 0
    const movedTo = body.starts_at
    if (typeof movedTo === 'string' && movedTo !== existing.starts_at) {
      const { data: pending } = await supabase
        .from('appointment_reminders')
        .select('id, offset_minutes, channel, template_name, template_language')
        .eq('appointment_id', id)
        .eq('status', 'pending')

      const offsets = (pending ?? []).map((r) => r.offset_minutes)
      const planned = planReminders(movedTo, offsets)

      // Drop the old pending set wholesale, then re-insert what still
      // lands in the future. Editing in place would leave a reminder
      // whose new send_at is in the past sitting as `pending` forever.
      if ((pending ?? []).length > 0) {
        await supabase
          .from('appointment_reminders')
          .delete()
          .eq('appointment_id', id)
          .eq('status', 'pending')
      }

      if (planned.length > 0) {
        const first = pending?.[0]
        const contact = existing.contact as { name?: string | null } | null
        const rows = planned.map((p) => ({
          appointment_id: id,
          user_id: user.id,
          send_at: p.send_at,
          offset_minutes: p.offset_minutes,
          channel: first?.channel ?? 'text',
          message_text:
            (first?.channel ?? 'text') === 'text'
              ? defaultReminderText({
                  contactName: contact?.name,
                  title: updated.title,
                  startsAtIso: updated.starts_at,
                  timeZone: updated.timezone,
                  location: updated.location,
                })
              : null,
          template_name: first?.template_name ?? null,
          template_language: first?.template_language ?? 'en_US',
        }))
        const { error: reinsertError } = await supabase
          .from('appointment_reminders')
          .insert(rows)
        if (reinsertError) {
          console.error(
            '[appointments] reminder reschedule failed:',
            reinsertError.message
          )
          return NextResponse.json(
            {
              appointment: updated,
              reminders_rescheduled: 0,
              warning: `Appointment moved, but its reminders could not be rescheduled: ${reinsertError.message}`,
            },
            { status: 207 }
          )
        }
        remindersRescheduled = rows.length
      }
    }

    return NextResponse.json({
      appointment: updated,
      reminders_rescheduled: remindersRescheduled,
    })
  } catch (error) {
    console.error('[appointments] PATCH exception:', error)
    return NextResponse.json(
      { error: 'Failed to update appointment' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Reminders cascade with the booking (FK ON DELETE CASCADE).
  const { error } = await supabase.from('appointments').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
