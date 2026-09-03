import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildUpiLink } from '@/lib/billing/invoice'

/**
 * Raise an invoice from a captured order.
 *
 * This is the seam between the commerce and billing halves: a cart the
 * customer sent becomes a bill they can pay, without anyone retyping
 * the amount — which is exactly where a transcription error would cost
 * real money.
 */
export async function POST(
  _request: Request,
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

    const { data: order, error: findError } = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('id', id)
      .maybeSingle()
    if (findError || !order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    if (order.invoice_id) {
      return NextResponse.json(
        { error: 'This order already has an invoice' },
        { status: 400 }
      )
    }
    if (order.total_minor <= 0) {
      return NextResponse.json(
        { error: 'Order total is zero — nothing to invoice' },
        { status: 400 }
      )
    }

    const { data: number, error: numberError } = await supabase.rpc(
      'next_invoice_number',
      { p_user_id: user.id }
    )
    if (numberError || !number) {
      return NextResponse.json(
        { error: `Could not allocate an invoice number: ${numberError?.message}` },
        { status: 500 }
      )
    }

    const { data: settings } = await supabase
      .from('billing_settings')
      .select('upi_vpa, upi_payee_name')
      .eq('user_id', user.id)
      .maybeSingle()

    const items = (order.items ?? []) as { name?: string | null; quantity: number }[]
    const description =
      items.length === 1 && items[0].name
        ? `${items[0].name} × ${items[0].quantity}`
        : `WhatsApp order (${items.length} line${items.length === 1 ? '' : 's'})`

    const { data: invoice, error: insertError } = await supabase
      .from('invoices')
      .insert({
        user_id: user.id,
        contact_id: order.contact_id,
        conversation_id: order.conversation_id,
        number,
        description,
        // Straight from the order — never recomputed from current
        // product prices, which may have changed since the cart.
        amount_minor: order.total_minor,
        currency: order.currency,
        status: 'draft',
        payment_url: buildUpiLink({
          vpa: settings?.upi_vpa,
          payeeName: settings?.upi_payee_name,
          amountMinor: order.total_minor,
          note: number as string,
        }),
      })
      .select()
      .single()

    if (insertError || !invoice) {
      return NextResponse.json(
        { error: `Failed to create invoice: ${insertError?.message}` },
        { status: 500 }
      )
    }

    await supabase
      .from('orders')
      .update({
        invoice_id: invoice.id,
        status: order.status === 'received' ? 'confirmed' : order.status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('[orders/invoice] unhandled exception:', error)
    return NextResponse.json(
      { error: 'Failed to raise invoice' },
      { status: 500 }
    )
  }
}
