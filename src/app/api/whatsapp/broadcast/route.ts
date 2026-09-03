import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  sendTemplateMessage,
  type TemplateHeaderParam,
} from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  phonesMatch,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  getTemplateSendBlocker,
  getTemplateHeaderRequirement,
} from '@/lib/whatsapp/template-capabilities'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
  /**
   * True when the recipient was never handed to Meta because they had
   * opted out of marketing. Reported as `failed` so the recipient row
   * reaches a terminal state, but counted separately in the response
   * so the UI can tell a policy skip from a delivery failure.
   */
  opted_out?: boolean
}

/** Wording is user-facing — it lands in broadcast_recipients.error_message. */
const OPTED_OUT_MESSAGE =
  'Skipped — this contact opted out of marketing messages'

/**
 * Every phone number this user has marked opted-out.
 *
 * The audience resolver already filters these out, so this is the
 * backstop for the paths it doesn't cover: a stale wizard tab, a CSV
 * re-upload, or a direct call to this API. Sending marketing to an
 * opted-out contact is a WhatsApp Business Policy violation, so the
 * check has to live on the server, not only in the client that happens
 * to build the audience.
 */
async function fetchOptedOutPhones(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<string[]> {
  const PAGE = 1000
  const phones: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('contacts')
      .select('phone')
      .eq('user_id', userId)
      .eq('marketing_opt_in', false)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) {
      // Fail closed would block every broadcast on a transient DB
      // hiccup; fail open and say so loudly instead. The client-side
      // audience filter is still in force on the normal path.
      console.error(
        `[broadcast] opt-out lookup failed — proceeding without the server-side guard: ${error.message}`
      )
      return phones
    }
    const rows = (data ?? []) as { phone: string | null }[]
    for (const r of rows) if (r.phone) phones.push(r.phone)
    if (rows.length < PAGE) break
  }
  return phones
}

/**
 * Two input shapes are accepted:
 *
 * NEW (preferred — supports per-recipient variable substitution):
 * {
 *   recipients: Array<{ phone: string; params: string[] }>,
 *   template_name, template_language
 * }
 *
 * LEGACY (all phones receive the same params — kept so existing
 * callers don't break):
 * {
 *   phone_numbers: string[],
 *   template_params: string[],
 *   template_name, template_language
 * }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  params?: string[]
}

/**
 * Turn opaque Meta template error codes into an actionable sentence.
 * #132012 / #132000 stem from the params not matching the template's
 * variables; #132001 means the name/language isn't on Meta at all. In
 * every case the fix is to reconcile the local template with Meta, so
 * point the user straight at the sync flow.
 */
function friendlyMetaError(raw: string | null): string {
  if (!raw) return 'Unknown error'
  if (raw.includes('132012') || raw.includes('132000')) {
    return `${raw} — the parameters sent don't match the template's variables on Meta. Sync your templates (Templates → Sync from Meta) so the stored copy matches Meta, then rebuild and resend the broadcast.`
  }
  if (raw.includes('131042')) {
    return `${raw} — the WhatsApp Business Account has no payment method (or a billing problem), so Meta refuses paid sends beyond the free tier. Add a payment method in Meta's Billing Hub (business.facebook.com/billing_hub), then resend.`
  }
  if (raw.includes('131056')) {
    return `${raw} — WhatsApp allows ~1 message per 6 seconds to the same person (pair rate limit). This recipient got messages too fast; they'll be reachable again shortly — resend later rather than immediately.`
  }
  if (raw.includes('132001')) {
    return `${raw} — Meta has no approved template with this name and language. Verify the template name/language, or sync templates from Meta.`
  }
  return raw
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

    // Per-user broadcast budget. The sending hook calls this route
    // once per 10-recipient batch, so the limit must absorb a full
    // campaign's batch cadence (see RATE_LIMITS.broadcast) — it exists
    // to cap runaway callers, not to meter messages inside a campaign.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      // Broadcast-level header content, shared by every recipient:
      // the text-header variable's value, or a public https URL for
      // an image/video/document header.
      header_value,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Fetch the local template body_text so we can log it and detect
    // mismatches between what's stored in the DB vs what Meta expects.
    // Diagnostic-only — never let it fail the broadcast. A user can have
    // several templates that share a name across languages, so filter by
    // language when provided and take the first row (limit(1)) rather than
    // .maybeSingle(), which errors on more than one match.
    let templateQuery = supabase
      .from('message_templates')
      .select('body_text, header_type, header_content')
      .eq('user_id', user.id)
      .eq('name', template_name)
    if (template_language) {
      templateQuery = templateQuery.eq('language', template_language)
    }
    const { data: templateRows, error: templateLookupError } =
      await templateQuery.limit(1)
    const templateRow = templateRows?.[0] ?? null
    if (templateLookupError) {
      console.warn(
        `[broadcast] template DB lookup failed (diagnostic only): ${templateLookupError.message}`
      )
    }
    console.log(
      `[broadcast] template DB body_text="${templateRow?.body_text?.slice(0, 120) ?? '(not found in DB)'}"  hasPlaceholders=${/\{\{\d+\}\}/.test(templateRow?.body_text ?? '')}  paramsSentPerRecipient=${JSON.stringify(recipients.map(r => ({ phone: r.phone, params: r.params ?? [] })))}`
    )

    // ── Pre-flight template-shape guard ────────────────────────────
    // Fail the whole request once with an actionable reason instead of
    // letting Meta reject every recipient with #132012.
    let templateHeader: TemplateHeaderParam | undefined
    if (templateRow) {
      // Named parameters: nothing the caller supplies can fix these.
      const blocker = getTemplateSendBlocker(templateRow)
      if (blocker) {
        console.error(
          `[broadcast] ✗ BLOCKED  template="${template_name}" unsupported shape: ${blocker}`
        )
        return NextResponse.json(
          { error: blocker, code: 'TEMPLATE_SHAPE_UNSUPPORTED' },
          { status: 400 }
        )
      }

      // Header requirement: Meta wants the header's content (media URL
      // or text-variable value) on every send — resolve it from
      // header_value or refuse.
      const requirement = getTemplateHeaderRequirement(templateRow)
      if (requirement) {
        const value = typeof header_value === 'string' ? header_value.trim() : ''
        if (!value) {
          const what =
            requirement.kind === 'media'
              ? `a public https URL for its ${requirement.mediaType} header`
              : 'a value for the {{N}} variable in its header'
          return NextResponse.json(
            {
              error: `Template "${template_name}" requires ${what}. Provide it in the personalize step and resend.`,
              code: 'TEMPLATE_HEADER_REQUIRED',
            },
            { status: 400 }
          )
        }
        if (requirement.kind === 'media' && !/^https:\/\//i.test(value)) {
          return NextResponse.json(
            {
              error: `Header ${requirement.mediaType} must be a public https:// URL — Meta fetches it directly and rejects anything else.`,
              code: 'TEMPLATE_HEADER_INVALID',
            },
            { status: 400 }
          )
        }
        templateHeader =
          requirement.kind === 'media'
            ? { type: requirement.mediaType, value }
            : { type: 'text', value }
      }
    }

    // ── Pre-flight parameter/placeholder guard ─────────────────────
    // The #1 cause of Meta error #132012 ("Parameter format does not
    // match format in the created template") is a mismatch between the
    // number of {{N}} variables the template body has and the number of
    // params we send. Catch it here, BEFORE spending any send quota, and
    // return a message that says exactly how to fix it.
    //
    // Only enforced when the template is stored locally — if it isn't in
    // the DB we can't know its shape, so we let Meta be the authority.
    if (templateRow?.body_text != null) {
      const expectedParamCount = new Set(
        (templateRow.body_text.match(/\{\{(\d+)\}\}/g) ?? []).map((m: string) =>
          m.replace(/\D/g, '')
        )
      ).size

      const mismatched = recipients
        .map((r, i) => ({
          index: i,
          phone: r.phone,
          got: (r.params ?? []).length,
        }))
        .filter((r) => r.got !== expectedParamCount)

      if (mismatched.length > 0) {
        const sample = mismatched.slice(0, 5)
        console.error(
          `[broadcast] ✗ BLOCKED  template="${template_name}" expects ${expectedParamCount} param(s); ${mismatched.length}/${recipients.length} recipient(s) supplied a different count. Sample: ${JSON.stringify(sample)}`
        )
        return NextResponse.json(
          {
            error:
              expectedParamCount === 0
                ? `Template "${template_name}" has no {{1}}-style variables in its stored body, but ${mismatched.length} of ${recipients.length} recipient(s) were given parameter values. If the real template on Meta actually has variables, sync your templates (Templates → Sync from Meta) so the stored copy matches Meta, then rebuild the broadcast.`
                : `Template "${template_name}" expects ${expectedParamCount} variable value(s) per recipient, but ${mismatched.length} of ${recipients.length} recipient(s) supplied a different number. Map every {{N}} placeholder in the personalize step so each recipient has exactly ${expectedParamCount} value(s), then try again.`,
            code: 'TEMPLATE_PARAM_MISMATCH',
            expected_param_count: expectedParamCount,
            mismatched_sample: sample,
          },
          { status: 400 }
        )
      }
    }

    // ── Broadcast start log ────────────────────────────────────────
    console.log(
      `[broadcast] ▶ START  template="${template_name}"  lang="${template_language || 'en_US'}"  recipients=${recipients.length}  phoneNumberId="${config.phone_number_id}"`
    )

    const optedOutPhones = await fetchOptedOutPhones(supabase, user.id)
    if (optedOutPhones.length > 0) {
      console.log(
        `[broadcast] opt-out list loaded — ${optedOutPhones.length} contact(s) excluded from marketing`
      )
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0
    let optedOutCount = 0

    for (const recipient of recipients) {
      if (optedOutPhones.some((p) => phonesMatch(p, recipient.phone))) {
        console.warn(
          `[broadcast] ✗ SKIP   phone="${recipient.phone}"  reason="contact opted out of marketing"`
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: OPTED_OUT_MESSAGE,
          opted_out: true,
        })
        optedOutCount++
        failedCount++
        continue
      }

      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        console.warn(
          `[broadcast] ✗ SKIP   phone="${recipient.phone}"  reason="Invalid E.164 format after sanitization (sanitized="${sanitized}")"`
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      console.log(
        `[broadcast] → TRY    phone="${recipient.phone}"  sanitized="${sanitized}"  variants=[${variants.join(', ')}]  params=[${(recipient.params ?? []).join(', ')}]`
      )

      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          console.log(
            `[broadcast]   attempt phone="${variant}"  template="${template_name}"  lang="${template_language || 'en_US'}"`
          )
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            params: recipient.params ?? [],
            header: templateHeader,
          })
          sentMessageId = result.messageId
          lastError = null
          console.log(
            `[broadcast]   ✓ OK    phone="${variant}"  waMessageId="${sentMessageId}"`
          )
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          console.warn(
            `[broadcast]   ✗ FAIL  phone="${variant}"  error="${errorMessage}"`
          )
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            console.warn(
              `[broadcast]   ↳ non-retryable error — stopping variant loop for this recipient`
            )
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
      } else {
        console.error(
          `[broadcast] ✗ FAILED phone="${recipient.phone}"  finalError="${lastError}"`
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: friendlyMetaError(lastError),
        })
        failedCount++
      }
    }

    // ── Broadcast summary log ──────────────────────────────────────
    console.log(
      `[broadcast] ■ END    template="${template_name}"  total=${recipients.length}  sent=${sentCount}  failed=${failedCount}  optedOut=${optedOutCount}`
    )
    if (failedCount > 0) {
      console.error('[broadcast] Failed recipients:')
      results
        .filter((r) => r.status === 'failed')
        .forEach((r) =>
          console.error(`  phone="${r.phone}"  reason="${r.error}"`)
        )
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      // Subset of `failed` — never reached Meta, no send quota spent.
      opted_out: optedOutCount,
      results,
    })
  } catch (error) {
    console.error('[broadcast] Unhandled exception in POST handler:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
