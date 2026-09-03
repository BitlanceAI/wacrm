import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { resolveTenantUserId } from '@/lib/team/tenant'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { resolveSeatLimit } from '@/lib/billing/platform'

/**
 * Team management (Path-B multi-user). Owner-only:
 *   GET    — list members (joined with profile names)
 *   POST   — invite: creates the auth account (admin API, confirmed
 *            email, generated password returned ONCE) + membership row
 *   DELETE — remove a member: membership row + the invite-created
 *            auth account
 *
 * Seat limit comes from the owner's paid plan (plans.max_seats via
 * platform_subscriptions — see resolveSeatLimit). Accounts with no
 * subscription keep the pre-billing flat cap of 25.
 */

async function requireOwner() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 401 as const }
  const tenantId = await resolveTenantUserId(supabase, user.id)
  if (tenantId !== user.id) return { error: 403 as const }
  return { supabase, user }
}

export async function GET() {
  const ctx = await requireOwner()
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? 'Unauthorized' : 'Only the workspace owner can manage the team.' },
      { status: ctx.error }
    )
  }

  const { data: members, error } = await ctx.supabase
    .from('team_members')
    .select('id, member_user_id, role, status, invited_email, created_at')
    .order('created_at', { ascending: true })
  if (error) {
    return NextResponse.json({ error: 'Failed to load team' }, { status: 500 })
  }

  // Names come from profiles; fetched with the admin client because
  // profiles RLS is strictly self-scoped.
  const ids = (members ?? []).map((m) => m.member_user_id)
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: profiles } = await getAdminClient()
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', ids)
    for (const p of profiles ?? []) {
      nameById.set(p.user_id, p.full_name || p.email)
    }
  }

  return NextResponse.json({
    members: (members ?? []).map((m) => ({
      ...m,
      display_name: nameById.get(m.member_user_id) ?? m.invited_email ?? 'Member',
    })),
    max_seats: await resolveSeatLimit(getAdminClient(), ctx.user.id).then((n) =>
      Number.isFinite(n) ? n : null
    ),
  })
}

export async function POST(request: Request) {
  const ctx = await requireOwner()
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? 'Unauthorized' : 'Only the workspace owner can manage the team.' },
      { status: ctx.error }
    )
  }

  const limit = checkRateLimit(`team-invite:${ctx.user.id}`, {
    limit: 10,
    windowMs: 60_000,
  })
  if (!limit.success) return rateLimitResponse(limit)

  const body = await request.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const fullName = String(body.full_name ?? '').trim()
  const role = body.role === 'admin' ? 'admin' : 'agent'

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  const seatLimit = await resolveSeatLimit(getAdminClient(), ctx.user.id)
  const { count } = await ctx.supabase
    .from('team_members')
    .select('id', { count: 'exact', head: true })
  if ((count ?? 0) >= seatLimit) {
    return NextResponse.json(
      {
        error:
          seatLimit === 0
            ? 'Your plan is single-user. Upgrade in Settings → Billing to invite team members.'
            : `Your plan allows ${seatLimit} team member${seatLimit === 1 ? '' : 's'}. Upgrade in Settings → Billing for more seats.`,
      },
      { status: 400 }
    )
  }

  // Create the member's auth account with a generated password the
  // owner passes on. email_confirm skips the verification round-trip —
  // the owner is vouching for the address.
  const password = crypto.randomBytes(9).toString('base64url') + '1!'
  const admin = getAdminClient()
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName || email },
  })
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? 'Failed to create the member account'
    // Most common: the email already has an account. A pre-existing
    // account can't be adopted in v1 — it may own its own tenant data.
    return NextResponse.json(
      {
        error: msg.includes('already')
          ? 'That email already has an account. Team invites currently require a fresh email address.'
          : msg,
      },
      { status: 400 }
    )
  }

  const { error: memberErr } = await ctx.supabase.from('team_members').insert({
    owner_user_id: ctx.user.id,
    member_user_id: created.user.id,
    role,
    invited_email: email,
  })
  if (memberErr) {
    // Roll back the orphan auth account so the email stays reusable.
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: 'Failed to add the member' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    member_user_id: created.user.id,
    email,
    // Shown once in the UI; not stored anywhere.
    password,
  })
}

export async function DELETE(request: Request) {
  const ctx = await requireOwner()
  if ('error' in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? 'Unauthorized' : 'Only the workspace owner can manage the team.' },
      { status: ctx.error }
    )
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: row } = await ctx.supabase
    .from('team_members')
    .select('id, member_user_id')
    .eq('id', id)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { error: delErr } = await ctx.supabase
    .from('team_members')
    .delete()
    .eq('id', id)
  if (delErr) {
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }

  // The account only existed for this team (invite-created), so remove
  // it too — leaving it would strand a login that can access nothing.
  await getAdminClient().auth.admin.deleteUser(row.member_user_id)

  return NextResponse.json({ success: true })
}
