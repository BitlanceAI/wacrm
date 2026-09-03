import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText } from '@/lib/automations/meta-send'
import { invoiceMessage } from '@/lib/billing/invoice'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Send an invoice to its contact on WhatsApp.
 *
 * Free text, so it only lands inside the 24-hour service window. That
 * limitation is Meta's, not ours, and the error says so plainly rather
 * than reporting a generic failure — the operator's next step (send an
 * approved template instead) depends on knowing which one it was.
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

    const limit = checkRateLimit(`invoice-send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: invoice, error: findError } = await supabase
      .from('invoices')
      .select('*, contact:contacts(id, name)')
      .eq('id', id)
      .maybeSingle()
    if (findError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }
    if (invoice.status === 'paid' || invoice.status === 'void') {
      return NextResponse.json(
        { error: `This invoice is already ${invoice.status}` },
        { status: 400 }
      )
    }

    const { data: settings } = await supabase
      .from('billing_settings')
      .select('payment_instructions')
      .eq('user_id', user.id)
      .maybeSingle()

    // The invoice needs a thread to land in. A contact who has never
    // messaged has no conversation and cannot be messaged first with
    // free text under Meta's rules.
    let conversationId = invoice.conversation_id as string | null
    if (!conversationId) {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('contact_id', invoice.contact_id)
        .maybeSingle()
      conversationId = conv?.id ?? null
    }
    if (!conversationId) {
      return NextResponse.json(
        {
          error:
            'No conversation with this contact yet. They need to message you first before an invoice can be sent as free text.',
        },
        { status: 400 }
      )
    }

    const contact = invoice.contact as { name?: string | null } | null
    const text = invoiceMessage({
      contactName: contact?.name,
      number: invoice.number,
      description: invoice.description,
      amountMinor: invoice.amount_minor,
      currency: invoice.currency,
      dueDate: invoice.due_date,
      paymentUrl: invoice.payment_url,
      instructions: settings?.payment_instructions,
      tone: 'new',
    })

    try {
      await engineSendText({
        userId: user.id,
        conversationId,
        contactId: invoice.contact_id,
        text,
      })
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : 'Unknown error'
      return NextResponse.json(
        {
          error: /re-?engagement|24|window|outside/i.test(message)
            ? `${message} — this contact is outside the 24-hour window, so the invoice must go out as an approved template instead.`
            : message,
        },
        { status: 502 }
      )
    }

    // Only advance draft -> sent. An already-overdue invoice re-sent by
    // hand must not be quietly downgraded back to "sent".
    const admin = supabaseAdmin()
    await admin
      .from('invoices')
      .update({
        status: invoice.status === 'draft' ? 'sent' : invoice.status,
        sent_at: new Date().toISOString(),
        conversation_id: conversationId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({ sent: true })
  } catch (error) {
    console.error('[invoices/send] unhandled exception:', error)
    return NextResponse.json({ error: 'Failed to send invoice' }, { status: 500 })
  }
}
