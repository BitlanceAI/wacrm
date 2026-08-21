import { describe, expect, it } from 'vitest'
import {
  getTemplateHeaderRequirement,
  getTemplateSendBlocker,
} from './template-capabilities'

describe('getTemplateSendBlocker', () => {
  it('allows a plain positional-body template', () => {
    expect(
      getTemplateSendBlocker({ body_text: 'Hi {{1}}, your order {{2}} shipped.' }),
    ).toBeNull()
  })

  it('allows a static text header', () => {
    expect(
      getTemplateSendBlocker({
        body_text: 'Hello {{1}}',
        header_type: 'text',
        header_content: 'Order update',
      }),
    ).toBeNull()
  })

  it('allows a body with no variables at all', () => {
    expect(getTemplateSendBlocker({ body_text: 'Store closed today.' })).toBeNull()
  })

  it('allows media headers (satisfiable via header requirement)', () => {
    expect(
      getTemplateSendBlocker({ body_text: 'Hi {{1}}', header_type: 'image' }),
    ).toBeNull()
  })

  it('blocks named parameters in the body', () => {
    expect(
      getTemplateSendBlocker({ body_text: 'Hi {{first_name}}, welcome!' }),
    ).toMatch(/named variables/)
  })

  it('blocks named parameters in a text header', () => {
    expect(
      getTemplateSendBlocker({
        body_text: 'Plain body',
        header_type: 'text',
        header_content: 'Hi {{name}}',
      }),
    ).toMatch(/named variables/)
  })
})

describe('getTemplateHeaderRequirement', () => {
  it('requires nothing for no header', () => {
    expect(getTemplateHeaderRequirement({ body_text: 'Hi {{1}}' })).toBeNull()
  })

  it('requires nothing for a static text header', () => {
    expect(
      getTemplateHeaderRequirement({
        body_text: 'Hi {{1}}',
        header_type: 'text',
        header_content: 'Order update',
      }),
    ).toBeNull()
  })

  it.each(['image', 'video', 'document'] as const)(
    'requires media for a %s header',
    (t) => {
      expect(
        getTemplateHeaderRequirement({ body_text: 'Hi', header_type: t }),
      ).toEqual({ kind: 'media', mediaType: t })
    },
  )

  it('requires a value for a text header with a positional variable', () => {
    expect(
      getTemplateHeaderRequirement({
        body_text: 'Body {{1}}',
        header_type: 'text',
        header_content: 'Hello {{1}}!',
      }),
    ).toEqual({ kind: 'text_variable' })
  })

  it('treats null header fields as absent', () => {
    expect(
      getTemplateHeaderRequirement({
        body_text: 'Hi {{1}}',
        header_type: null,
        header_content: null,
      }),
    ).toBeNull()
  })
})
