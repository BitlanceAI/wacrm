import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseAmountToMinor } from '@/lib/billing/money'
import {
  buildUpiLink,
  planInvoiceReminders,
  invoiceMessage,
  DEFAULT_DUNNING_OFFSETS_DAYS,
} from '@/lib/billing/invoice'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Invoices collection.
 *
 * Creating an invoice also schedules its dunning ladder, for the same
 * reason appointments schedule their own reminders: an invoice with no
 * chase attached is one somebody has to remember to follow up by hand,
 * which is the problem this feature exists to remove.
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

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const contactId = searchParams.get('contact_id')

  let query = supabase
    .from('invoices')
    .select('*, contact:contacts(id, name, phone)')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)
  if (contactId) query = query.eq('contact_id', contactId)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ invoices: data ?? [] })
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

    const limit = checkRateLimit(`invoices:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const { contact_id, description, amount, due_date, notes } = body

    if (!contact_id || !description?.trim()) {
      return NextResponse.json(
        { error: 'contact_id and description are required' },
        { status: 400 }
      )
    }

    const amountMinor = parseAmountToMinor(amount)
    if (amountMinor === null) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 }
      )
    }

    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('id, name')
      .eq('id', contact_id)
      .maybeSingle()
    if (contactError || !contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    // Settings row may not exist yet; next_invoice_number() creates it.
    const { data: settings } = await supabase
      .from('billing_settings')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()

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

    const currency = body.currency ?? settings?.currency ?? 'INR'
    // An explicit link always wins; UPI is the zero-setup fallback.
    const paymentUrl =
      body.payment_url?.trim() ||
      buildUpiLink({
        vpa: settings?.upi_vpa,
        payeeName: settings?.upi_payee_name,
        amountMinor,
        note: number as string,
      })

    const { data: invoice, error: insertError } = await supabase
      .from('invoices')
      .insert({
        user_id: user.id,
        contact_id,
        number,
        description: description.trim(),
        amount_minor: amountMinor,
        currency,
        due_date: due_date || null,
        payment_url: paymentUrl,
        notes: notes ?? null,
        subscription_id: body.subscription_id ?? null,
      })
      .select()
      .single()
    if (insertError || !invoice) {
      return NextResponse.json(
        { error: `Failed to create invoice: ${insertError?.message}` },
        { status: 500 }
      )
    }

    // Dunning ladder. Skipped entirely without a due date — there is
    // nothing to be late for, so chasing would be arbitrary.
    let remindersCreated = 0
    const offsets: number[] = Array.isArray(body.reminder_offsets_days)
      ? body.reminder_offsets_days
      : [...DEFAULT_DUNNING_OFFSETS_DAYS]
    const planned = planInvoiceReminders(invoice.due_date, offsets)

    if (planned.length > 0) {
      const rows = planned.map((p) => ({
        invoice_id: invoice.id,
        user_id: user.id,
        send_at: p.send_at,
        offset_days: p.offset_days,
        channel: 'text' as const,
        message_text: invoiceMessage({
          contactName: contact.name,
          number: invoice.number,
          description: invoice.description,
          amountMinor: invoice.amount_minor,
          currency: invoice.currency,
          dueDate: invoice.due_date,
          paymentUrl: invoice.payment_url,
          instructions: settings?.payment_instructions,
          tone: p.offset_days < 0 ? 'reminder' : 'overdue',
        }),
      }))
      const { error: reminderError } = await supabase
        .from('invoice_reminders')
        .insert(rows)
      if (reminderError) {
        console.error('[invoices] reminder insert failed:', reminderError.message)
        return NextResponse.json(
          {
            invoice,
            reminders_created: 0,
            warning: `Invoice saved, but payment reminders could not be scheduled: ${reminderError.message}`,
          },
          { status: 207 }
        )
      }
      remindersCreated = rows.length
    }

    return NextResponse.json({ invoice, reminders_created: remindersCreated })
  } catch (error) {
    console.error('[invoices] unhandled exception:', error)
    return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 })
  }
}
