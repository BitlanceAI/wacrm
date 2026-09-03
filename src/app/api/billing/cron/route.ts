import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { engineSendText, engineSendTemplate } from '@/lib/automations/meta-send'
import {
  isOverdue,
  isRenewalDue,
  nextRenewalDate,
  invoiceMessage,
  planInvoiceReminders,
  buildUpiLink,
  DEFAULT_DUNNING_OFFSETS_DAYS,
  type RenewalInterval,
} from '@/lib/billing/invoice'

/**
 * Billing sweep. Three jobs, in order:
 *
 *   1. Flag invoices that have passed their due date as `overdue`.
 *   2. Send due payment reminders.
 *   3. Roll active subscriptions forward, raising an invoice for any
 *      set to auto-invoice.
 *
 * Ordering matters: marking overdue first means a reminder sent in the
 * same tick describes the invoice's real state, rather than calling an
 * overdue bill merely "due".
 *
 * Auth mirrors the other cron routes (shared AUTOMATION_CRON_SECRET,
 * separate URL). Daily is enough — every deadline here is date-grained.
 */

export const maxDuration = 60

function secretsMatch(supplied: string, expected: string | undefined): boolean {
  if (!expected || !supplied) return false
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  return (
    suppliedBuf.length === expectedBuf.length &&
    timingSafeEqual(suppliedBuf, expectedBuf)
  )
}

export async function GET(request: Request) {
  if (!process.env.AUTOMATION_CRON_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  // Two auth styles, one route:
  //  - external schedulers send `x-cron-secret: AUTOMATION_CRON_SECRET`
  //    (the convention shared with the flows/appointments sweeps)
  //  - Vercel Cron can ONLY send `Authorization: Bearer ${CRON_SECRET}`
  //    (attached automatically when a CRON_SECRET env var exists) —
  //    custom headers are not configurable there.
  const headerSecret = request.headers.get('x-cron-secret') ?? ''
  const bearer = (request.headers.get('authorization') ?? '').replace(
    /^Bearer\s+/i,
    ''
  )
  const authorized =
    secretsMatch(headerSecret, process.env.AUTOMATION_CRON_SECRET) ||
    secretsMatch(bearer, process.env.CRON_SECRET) ||
    secretsMatch(bearer, process.env.AUTOMATION_CRON_SECRET)
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const now = new Date()

  // ── 1. Mark overdue ───────────────────────────────────────────────
  let markedOverdue = 0
  const { data: sentInvoices } = await admin
    .from('invoices')
    .select('id, status, due_date')
    .eq('status', 'sent')
    .not('due_date', 'is', null)
    .limit(1000)

  const overdueIds = (sentInvoices ?? [])
    .filter((inv) => isOverdue(inv, now))
    .map((inv) => inv.id)

  if (overdueIds.length > 0) {
    const { error } = await admin
      .from('invoices')
      .update({ status: 'overdue', updated_at: now.toISOString() })
      .in('id', overdueIds)
    if (error) {
      console.error('[billing/cron] overdue update failed:', error.message)
    } else {
      markedOverdue = overdueIds.length
    }
  }

  // ── 2. Send due reminders ─────────────────────────────────────────
  let sent = 0
  let skipped = 0
  let failed = 0

  const { data: dueReminders } = await admin
    .from('invoice_reminders')
    .select(
      'id, user_id, invoice_id, channel, message_text, template_name, template_language, invoices!inner(id, status, contact_id, conversation_id)'
    )
    .eq('status', 'pending')
    .is('claimed_at', null)
    .lte('send_at', now.toISOString())
    .order('send_at', { ascending: true })
    .limit(200)

  for (const reminder of dueReminders ?? []) {
    const invoice = (
      Array.isArray(reminder.invoices) ? reminder.invoices[0] : reminder.invoices
    ) as {
      id: string
      status: string
      contact_id: string
      conversation_id: string | null
    }

    const { data: claimed } = await admin
      .from('invoice_reminders')
      .update({ claimed_at: now.toISOString() })
      .eq('id', reminder.id)
      .is('claimed_at', null)
      .select('id')
      .maybeSingle()
    if (!claimed) {
      skipped++
      continue
    }

    // Belt and braces alongside the DB trigger: never chase a settled
    // invoice, even if the trigger somehow didn't fire.
    if (!['sent', 'overdue', 'draft'].includes(invoice.status)) {
      await admin
        .from('invoice_reminders')
        .update({
          status: 'skipped',
          error_message: `Invoice is ${invoice.status}`,
        })
        .eq('id', reminder.id)
      skipped++
      continue
    }

    let conversationId = invoice.conversation_id
    if (!conversationId) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('user_id', reminder.user_id)
        .eq('contact_id', invoice.contact_id)
        .maybeSingle()
      conversationId = conv?.id ?? null
    }
    if (!conversationId) {
      await admin
        .from('invoice_reminders')
        .update({
          status: 'failed',
          error_message: 'No conversation with this contact to send into',
        })
        .eq('id', reminder.id)
      failed++
      continue
    }

    try {
      if (reminder.channel === 'template' && reminder.template_name) {
        await engineSendTemplate({
          userId: reminder.user_id,
          conversationId,
          contactId: invoice.contact_id,
          templateName: reminder.template_name,
          language: reminder.template_language ?? 'en_US',
        })
      } else {
        await engineSendText({
          userId: reminder.user_id,
          conversationId,
          contactId: invoice.contact_id,
          text: reminder.message_text ?? 'You have a payment due.',
        })
      }
      await admin
        .from('invoice_reminders')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', reminder.id)
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await admin
        .from('invoice_reminders')
        .update({ status: 'failed', error_message: message })
        .eq('id', reminder.id)
      failed++
    }
  }

  // ── 3. Roll subscriptions forward ─────────────────────────────────
  let renewed = 0
  let invoicesRaised = 0

  const { data: subscriptions } = await admin
    .from('subscriptions')
    .select('*, contact:contacts(id, name)')
    .eq('status', 'active')
    .lte('next_renewal_date', now.toISOString().slice(0, 10))
    .limit(500)

  for (const sub of subscriptions ?? []) {
    if (!isRenewalDue(sub, now)) continue

    if (sub.auto_invoice) {
      try {
        const { data: settings } = await admin
          .from('billing_settings')
          .select('*')
          .eq('user_id', sub.user_id)
          .maybeSingle()

        // The RPC refuses to allocate for anyone but the caller, and
        // the cron has no session — so the number is composed here from
        // the same counter, updated in the same statement.
        const { data: bumped } = await admin
          .from('billing_settings')
          .update({
            invoice_next_number: (settings?.invoice_next_number ?? 1) + 1,
            updated_at: now.toISOString(),
          })
          .eq('user_id', sub.user_id)
          .select('invoice_prefix, invoice_next_number')
          .maybeSingle()

        const seq = (bumped?.invoice_next_number ?? 2) - 1
        const number = `${bumped?.invoice_prefix ?? 'INV-'}${String(seq).padStart(4, '0')}`

        const dueDate = sub.next_renewal_date
        const paymentUrl = buildUpiLink({
          vpa: settings?.upi_vpa,
          payeeName: settings?.upi_payee_name,
          amountMinor: sub.amount_minor,
          note: number,
        })

        const { data: invoice, error: invError } = await admin
          .from('invoices')
          .insert({
            user_id: sub.user_id,
            contact_id: sub.contact_id,
            subscription_id: sub.id,
            number,
            description: `${sub.plan_name} renewal`,
            amount_minor: sub.amount_minor,
            currency: sub.currency,
            due_date: dueDate,
            payment_url: paymentUrl,
            status: 'draft',
          })
          .select()
          .single()

        if (invError || !invoice) {
          console.error('[billing/cron] renewal invoice failed:', invError?.message)
        } else {
          invoicesRaised++
          const contact = sub.contact as { name?: string | null } | null
          const planned = planInvoiceReminders(
            dueDate,
            [...DEFAULT_DUNNING_OFFSETS_DAYS],
            now
          )
          if (planned.length > 0) {
            await admin.from('invoice_reminders').insert(
              planned.map((p) => ({
                invoice_id: invoice.id,
                user_id: sub.user_id,
                send_at: p.send_at,
                offset_days: p.offset_days,
                channel: 'text',
                message_text: invoiceMessage({
                  contactName: contact?.name,
                  number,
                  description: invoice.description,
                  amountMinor: invoice.amount_minor,
                  currency: invoice.currency,
                  dueDate,
                  paymentUrl,
                  instructions: settings?.payment_instructions,
                  tone: p.offset_days < 0 ? 'reminder' : 'overdue',
                }),
              }))
            )
          }
        }
      } catch (err) {
        console.error(
          '[billing/cron] renewal handling threw:',
          err instanceof Error ? err.message : err
        )
      }
    }

    // Advance the clock even when invoicing failed — otherwise the
    // subscription would be retried every tick forever, spamming both
    // the log and (if it half-succeeded) the customer.
    const { error: advanceError } = await admin
      .from('subscriptions')
      .update({
        next_renewal_date: nextRenewalDate(
          sub.next_renewal_date,
          sub.interval as RenewalInterval
        ),
        updated_at: now.toISOString(),
      })
      .eq('id', sub.id)
    if (!advanceError) renewed++
  }

  console.log(
    `[billing/cron] overdue=${markedOverdue} remindersSent=${sent} skipped=${skipped} failed=${failed} renewed=${renewed} invoicesRaised=${invoicesRaised}`
  )
  return NextResponse.json({
    marked_overdue: markedOverdue,
    reminders_sent: sent,
    reminders_skipped: skipped,
    reminders_failed: failed,
    subscriptions_renewed: renewed,
    invoices_raised: invoicesRaised,
  })
}
