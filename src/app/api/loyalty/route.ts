import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Loyalty accounts and point movements.
 *
 * Points are never written directly: a POST here inserts a ledger row
 * and the database trigger moves the balance. That way the balance and
 * its history cannot disagree, whichever surface made the change.
 */
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
  const contactId = searchParams.get('contact_id')

  let query = supabase
    .from('loyalty_accounts')
    .select('*, contact:contacts(id, name, phone)')
    .order('lifetime_points', { ascending: false })
    .limit(200)
  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ accounts: data ?? [] })
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

  const tenantId = await resolveTenantUserId(supabase, user.id)

  const body = await request.json()
  const points = Number(body.points)
  if (!body.contact_id || !Number.isInteger(points) || points === 0) {
    return NextResponse.json(
      { error: 'contact_id and a non-zero whole number of points are required' },
      { status: 400 }
    )
  }
  if (!body.reason?.trim()) {
    return NextResponse.json(
      { error: 'reason is required — an unexplained points change is unauditable' },
      { status: 400 }
    )
  }

  // Open an account on first use rather than making it a separate step.
  const { data: account, error: accountError } = await supabase
    .from('loyalty_accounts')
    .upsert(
      { user_id: tenantId, contact_id: body.contact_id },
      { onConflict: 'user_id,contact_id', ignoreDuplicates: false }
    )
    .select('id, points_balance')
    .single()

  if (accountError || !account) {
    return NextResponse.json(
      { error: `Failed to open loyalty account: ${accountError?.message}` },
      { status: 500 }
    )
  }

  const { error: ledgerError } = await supabase
    .from('loyalty_transactions')
    .insert({
      account_id: account.id,
      user_id: tenantId,
      points,
      reason: body.reason.trim(),
      reference: body.reference ?? null,
    })

  if (ledgerError) {
    // The CHECK on points_balance rejects an over-redemption. Say so in
    // words the agent can act on rather than surfacing a constraint name.
    const overdrawn = /points_balance/.test(ledgerError.message)
    return NextResponse.json(
      {
        error: overdrawn
          ? `That would take the balance below zero — the contact has ${account.points_balance} points.`
          : ledgerError.message,
      },
      { status: 400 }
    )
  }

  const { data: updated } = await supabase
    .from('loyalty_accounts')
    .select('*, contact:contacts(id, name, phone)')
    .eq('id', account.id)
    .single()

  return NextResponse.json({ account: updated })
}
