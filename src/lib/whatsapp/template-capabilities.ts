/**
 * What does a locally-stored template need at send time, and can the
 * broadcast pipeline provide it?
 *
 * Meta templates fix their header's *shape* at creation, but the
 * content must be supplied on every send as a `header` component:
 *
 *  - IMAGE / VIDEO / DOCUMENT header  -> needs a media URL each send
 *  - TEXT header containing {{1}}     -> needs the variable's value
 *
 * Sending without it fails with Meta error #132012 ("Parameter format
 * does not match format in the created template"). The wizard uses
 * `getTemplateHeaderRequirement` to collect the value in the
 * personalize step; the broadcast API uses it to refuse a send that
 * arrived without one.
 *
 * NAMED parameter format ({{first_name}}-style) remains genuinely
 * unsupported — the whole pipeline (placeholder counting, personalize
 * step, preflight) assumes positional {{1}}/{{2}} placeholders — so
 * `getTemplateSendBlocker` still blocks it outright.
 */

export interface TemplateShape {
  body_text: string
  header_type?: string | null
  header_content?: string | null
}

/** Positional placeholder: {{1}}, {{2}}, … */
const POSITIONAL_RE = /\{\{\s*\d+\s*\}\}/
/** Named placeholder: {{first_name}} etc. — anything non-numeric. */
const NAMED_RE = /\{\{\s*[A-Za-z_][^}]*\}\}/

const MEDIA_HEADER_TYPES = ['image', 'video', 'document'] as const
export type MediaHeaderType = (typeof MEDIA_HEADER_TYPES)[number]

export type HeaderRequirement =
  | { kind: 'media'; mediaType: MediaHeaderType }
  | { kind: 'text_variable' }

/**
 * What (if anything) must the sender supply for this template's
 * header? null when the header is absent or static text.
 */
export function getTemplateHeaderRequirement(
  t: TemplateShape,
): HeaderRequirement | null {
  const headerType = t.header_type?.toLowerCase() ?? null

  if (headerType && (MEDIA_HEADER_TYPES as readonly string[]).includes(headerType)) {
    return { kind: 'media', mediaType: headerType as MediaHeaderType }
  }

  if (
    headerType === 'text' &&
    t.header_content &&
    POSITIONAL_RE.test(t.header_content)
  ) {
    return { kind: 'text_variable' }
  }

  return null
}

/**
 * Returns null when the broadcast pipeline can send this template, or
 * a human-readable reason when it can't at all (no input can fix it).
 */
export function getTemplateSendBlocker(t: TemplateShape): string | null {
  if (NAMED_RE.test(t.body_text) || NAMED_RE.test(t.header_content ?? '')) {
    return 'This template uses named variables (e.g. {{first_name}}). Broadcasts only support positional variables — recreate the template in WhatsApp Manager using {{1}}, {{2}}, … placeholders.'
  }

  return null
}
