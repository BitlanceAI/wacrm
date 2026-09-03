import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Single invoice: status changes (mark paid / void) and edits.
 *
 * Marking an invoice paid also stamps `paid_at`, and the DB trigger
 * from migration 019 cancels its pending reminders — so a customer who
 * has paid stops being chased no matter which surface recorded the
 * payment.
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
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    for (const field of [
      'description',
      'due_date',
      'payment_url',
      'notes',
      'external_reference',
      'status',
    ] as const) {
      if (body[field] !== undefined) patch[field] = body[field]
    }

    // paid_at is derived, never accepted from the client: the moment of
    // payment is when we were told, not when a caller claims.
    if (body.status === 'paid') {
      patch.paid_at = new Date().toISOString()
    } else if (body.status && body.status !== 'paid') {
      patch.paid_at = null
    }

    const { data: invoice, error } = await supabase
      .from('invoices')
      .update(patch)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('[invoices] PATCH exception:', error)
    return NextResponse.json({ error: 'Failed to update invoice' }, { status: 500 })
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

  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
