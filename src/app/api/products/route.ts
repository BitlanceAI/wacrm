import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseAmountToMinor } from '@/lib/billing/money'
import { resolveTenantUserId } from '@/lib/team/tenant'

/**
 * Local mirror of the Meta Commerce Manager catalog.
 *
 * This does not create products in Meta — WhatsApp renders product
 * cards from Meta's own copy, so items must exist there first. What
 * this stores is the join key (`retailer_id`) plus enough detail to
 * show a product in the CRM and to name the lines on an incoming order.
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
    .from('products')
    .select('*')
    .order('name')
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ products: data ?? [] })
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
  const retailerId = body.retailer_id?.trim()
  if (!retailerId || !body.name?.trim()) {
    return NextResponse.json(
      { error: 'retailer_id and name are required' },
      { status: 400 }
    )
  }

  // Price may legitimately be zero (a free sample), so an explicit 0 is
  // accepted while junk is not.
  const priceMinor =
    body.price === 0 || body.price === '0' ? 0 : parseAmountToMinor(body.price)
  if (priceMinor === null) {
    return NextResponse.json(
      { error: 'price must be zero or a positive number' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('products')
    .upsert(
      {
        user_id: tenantId,
        retailer_id: retailerId,
        catalog_id: body.catalog_id ?? null,
        name: body.name.trim(),
        description: body.description ?? null,
        price_minor: priceMinor,
        currency: body.currency ?? 'INR',
        image_url: body.image_url ?? null,
        in_stock: body.in_stock !== false,
        updated_at: new Date().toISOString(),
      },
      // Re-adding an existing SKU updates it rather than failing on the
      // unique index — re-importing a price list is a normal thing to do.
      { onConflict: 'user_id,retailer_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ product: data })
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

  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
