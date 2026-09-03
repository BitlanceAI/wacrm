import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseAmountToMinor } from '@/lib/billing/money'

/**
 * Recurring plans. The billing cron rolls `next_renewal_date` forward
 * and, for plans with `auto_invoice`, raises the invoice — so this
 * endpoint only has to get the plan itself right.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, contact:contacts(id, name, phone)')
    .order('next_renewal_date', { ascending: true })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ subscriptions: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const amountMinor = parseAmountToMinor(body.amount)
  if (!body.contact_id || !body.plan_name?.trim() || amountMinor === null) {
    return NextResponse.json(
      { error: 'contact_id, plan_name and a positive amount are required' },
      { status: 400 }
    )
  }
  if (!body.next_renewal_date) {
    return NextResponse.json(
      { error: 'next_renewal_date is required' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      user_id: user.id,
      contact_id: body.contact_id,
      plan_name: body.plan_name.trim(),
      amount_minor: amountMinor,
      currency: body.currency ?? 'INR',
      interval: body.interval ?? 'monthly',
      next_renewal_date: body.next_renewal_date,
      // Defaults to false in the schema too: nobody gets auto-billed
      // because a field was omitted.
      auto_invoice: body.auto_invoice === true,
      reminder_days_before: body.reminder_days_before ?? 3,
    })
    .select('*, contact:contacts(id, name, phone)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ subscription: data })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const field of [
    'plan_name',
    'interval',
    'next_renewal_date',
    'status',
    'auto_invoice',
    'reminder_days_before',
  ] as const) {
    if (body[field] !== undefined) patch[field] = body[field]
  }
  if (body.amount !== undefined) {
    const minor = parseAmountToMinor(body.amount)
    if (minor === null) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 }
      )
    }
    patch.amount_minor = minor
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .update(patch)
    .eq('id', body.id)
    .select('*, contact:contacts(id, name, phone)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ subscription: data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase.from('subscriptions').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
