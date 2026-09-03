import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseAmountToMinor } from '@/lib/billing/money'
import { normalizeCouponCode } from '@/lib/retention/loyalty'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Coupon definitions. Redemption lives in /api/coupons/redeem, since
 * that path has to validate against live state rather than just write
 * a record.
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

  const tenantId = await resolveTenantUserId(supabase, user.id)

  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupons: data ?? [] })
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
  const code = normalizeCouponCode(body.code ?? '')
  if (!code) {
    return NextResponse.json(
      { error: 'code is required (letters, numbers, - and _)' },
      { status: 400 }
    )
  }

  const type = body.discount_type === 'fixed' ? 'fixed' : 'percent'

  // Percent values are a plain 1-100; fixed values are money and go
  // through the same minor-unit parser as everything else.
  let value: number | null
  if (type === 'percent') {
    const percent = Number(body.discount_value)
    value =
      Number.isInteger(percent) && percent > 0 && percent <= 100 ? percent : null
    if (value === null) {
      return NextResponse.json(
        { error: 'A percentage discount must be a whole number from 1 to 100' },
        { status: 400 }
      )
    }
  } else {
    value = parseAmountToMinor(body.discount_value)
    if (value === null) {
      return NextResponse.json(
        { error: 'A fixed discount must be a positive amount' },
        { status: 400 }
      )
    }
  }

  const { data, error } = await supabase
    .from('coupons')
    .insert({
      user_id: tenantId,
      code,
      description: body.description ?? null,
      discount_type: type,
      discount_value: value,
      currency: body.currency ?? 'INR',
      max_redemptions: body.max_redemptions ?? null,
      once_per_contact: body.once_per_contact !== false,
      starts_at: body.starts_at ?? null,
      expires_at: body.expires_at ?? null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === '23505'
            ? `You already have a coupon with the code ${code}`
            : error.message,
      },
      { status: 400 }
    )
  }
  return NextResponse.json({ coupon: data })
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

  const tenantId = await resolveTenantUserId(supabase, user.id)

  const body = await request.json()
  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const field of ['description', 'active', 'expires_at', 'max_redemptions'] as const) {
    if (body[field] !== undefined) patch[field] = body[field]
  }

  const { data, error } = await supabase
    .from('coupons')
    .update(patch)
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupon: data })
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

  const tenantId = await resolveTenantUserId(supabase, user.id)

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { error } = await supabase.from('coupons').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
