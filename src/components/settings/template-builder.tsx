'use client';

/**
 * Full template builder — creates templates ON Meta (submits for
 * review), replacing the old local-only draft dialog whose output
 * could never actually be sent (#132001).
 *
 * Mirrors WhatsApp Manager's composer: name/language/category, header
 * (none / text-with-variable / image / video / document via upload),
 * body with {{N}} variables + required sample values, footer, buttons
 * (quick reply, URL, dynamic URL, phone, copy code), and a live
 * WhatsApp-style preview. Carousel / Authentication / Flow templates
 * are Meta-Manager-only — the banner links there.
 */

import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bold,
  Code,
  ExternalLink,
  Italic,
  Link2,
  Loader2,
  Phone,
  Plus,
  Reply,
  Strikethrough,
  Copy,
  Trash2,
  FileText,
  Image as ImageIcon,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LANGUAGES = [
  'en_US', 'en_GB', 'en', 'hi', 'mr', 'gu', 'ta', 'te', 'kn', 'ml', 'bn',
  'pa', 'ur', 'es', 'es_MX', 'pt_BR', 'fr', 'de', 'it', 'nl', 'ru', 'tr',
  'ar', 'id', 'ja', 'ko', 'zh_CN', 'th', 'vi',
];

type HeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

type ButtonType = 'QUICK_REPLY' | 'URL' | 'DYNAMIC_URL' | 'PHONE_NUMBER' | 'COPY_CODE';

interface BuilderButton {
  type: ButtonType;
  text: string;
  url: string;
  phone: string;
  example: string;
}

const MAX_BUTTONS = 10;

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

function uniquePlaceholders(text: string): string[] {
  const seen = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) seen.add(m[1]);
  return [...seen].sort((a, b) => Number(a) - Number(b));
}

interface TemplateBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wabaId: string | null;
  onCreated: () => void;
}

export function TemplateBuilder({ open, onOpenChange, wabaId, onCreated }: TemplateBuilderProps) {
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('en_US');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [headerType, setHeaderType] = useState<HeaderType>('none');
  const [headerText, setHeaderText] = useState('');
  const [headerTextExample, setHeaderTextExample] = useState('');
  const [headerHandle, setHeaderHandle] = useState('');
  const [headerFileName, setHeaderFileName] = useState('');
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [bodyText, setBodyText] = useState('');
  const [bodyExamples, setBodyExamples] = useState<Record<string, string>>({});
  const [footerText, setFooterText] = useState('');
  const [buttons, setButtons] = useState<BuilderButton[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const bodyVars = useMemo(() => uniquePlaceholders(bodyText), [bodyText]);
  const headerHasVar = uniquePlaceholders(headerText).length > 0;

  function sanitizeName(raw: string) {
    setName(raw.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, ''));
  }

  /** Wrap the current textarea selection in a WhatsApp format marker. */
  function wrapSelection(marker: string) {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const next = value.slice(0, s) + marker + value.slice(s, e) + marker + value.slice(e);
    setBodyText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + marker.length, e + marker.length);
    });
  }

  function addBodyVariable() {
    const next = bodyVars.length + 1;
    setBodyText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}{{${next}}}`);
    bodyRef.current?.focus();
  }

  async function handleHeaderFile(file: File | null) {
    if (!file) return;
    setUploadingHeader(true);
    setHeaderHandle('');
    setHeaderFileName(file.name);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/whatsapp/templates/upload-header', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setHeaderHandle(data.handle);
      toast.success('Header media uploaded');
    } catch (err) {
      setHeaderFileName('');
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingHeader(false);
    }
  }

  function addButton(type: ButtonType) {
    if (buttons.length >= MAX_BUTTONS) return;
    setButtons((b) => [...b, { type, text: '', url: '', phone: '', example: '' }]);
  }
  function updateButton(i: number, patch: Partial<BuilderButton>) {
    setButtons((b) => b.map((btn, idx) => (idx === i ? { ...btn, ...patch } : btn)));
  }
  function removeButton(i: number) {
    setButtons((b) => b.filter((_, idx) => idx !== i));
  }

  function resetForm() {
    setName(''); setLanguage('en_US'); setCategory('MARKETING');
    setHeaderType('none'); setHeaderText(''); setHeaderTextExample('');
    setHeaderHandle(''); setHeaderFileName(''); setBodyText('');
    setBodyExamples({}); setFooterText(''); setButtons([]);
  }

  async function handleSubmit() {
    if (!name.trim()) return toast.error('Template name is required');
    if (!bodyText.trim()) return toast.error('Body text is required');
    if (bodyVars.some((k) => !(bodyExamples[k] ?? '').trim()))
      return toast.error('Provide a sample value for every body variable — Meta reviews a rendered example');
    if (headerType !== 'none' && headerType !== 'text' && !headerHandle)
      return toast.error(`Upload the header ${headerType} first`);
    if (headerType === 'text' && headerHasVar && !headerTextExample.trim())
      return toast.error('Provide a sample value for the header variable');

    setSubmitting(true);
    try {
      const res = await fetch('/api/whatsapp/templates/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          language,
          category,
          body_text: bodyText.trim(),
          body_examples: bodyVars.map((k) => bodyExamples[k] ?? ''),
          header_type: headerType === 'none' ? null : headerType,
          header_text: headerType === 'text' ? headerText.trim() : undefined,
          header_text_example: headerTextExample.trim() || undefined,
          header_handle: headerHandle || undefined,
          footer_text: footerText.trim() || undefined,
          buttons: buttons.map((b) => {
            if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY' as const, text: b.text.trim() };
            if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER' as const, text: b.text.trim(), phone_number: b.phone.trim() };
            if (b.type === 'COPY_CODE') return { type: 'COPY_CODE' as const, example: b.example.trim() };
            // URL / DYNAMIC_URL both submit as URL; dynamic appends {{1}}
            const url = b.type === 'DYNAMIC_URL' ? `${b.url.trim().replace(/\/$/, '')}/{{1}}` : b.url.trim();
            return {
              type: 'URL' as const,
              text: b.text.trim(),
              url,
              ...(b.type === 'DYNAMIC_URL' ? { example: [b.example.trim()] } : {}),
            };
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Template creation failed');
      toast.success('Template submitted to Meta for review', {
        description: 'It appears as Pending until Meta approves it — usually minutes to a few hours.',
      });
      resetForm();
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Template creation failed');
    } finally {
      setSubmitting(false);
    }
  }

  /** Substitute sample values into a preview string. */
  function withSamples(text: string, samples: Record<string, string>) {
    return text.replace(PLACEHOLDER_RE, (m, k) => samples[k]?.trim() || m);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-background max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-foreground">Create Template</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Submitted directly to Meta for review — once approved it&apos;s ready to send.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* ── Form ─────────────────────────────────────────── */}
          <div className="space-y-4 lg:col-span-3">
            <div className="space-y-2">
              <Label className="text-foreground">Template Name</Label>
              <Input
                value={name}
                onChange={(e) => sanitizeName(e.target.value)}
                placeholder="order_update"
                className="border-border bg-accent text-foreground placeholder:text-muted-foreground font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, underscores only.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-foreground">Language</Label>
                <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
                  <SelectTrigger className="w-full bg-accent border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border max-h-64">
                    {LANGUAGES.map((l) => (
                      <SelectItem key={l} value={l}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Category</Label>
                <Select value={category} onValueChange={(v) => v && setCategory(v as 'MARKETING' | 'UTILITY')}>
                  <SelectTrigger className="w-full bg-accent border-border text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-background border-border">
                    <SelectItem value="MARKETING">Marketing</SelectItem>
                    <SelectItem value="UTILITY">Utility</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {wabaId && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
                <span>
                  Authentication, Flow and Carousel templates must be created on Meta.
                </span>
                <a
                  href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${encodeURIComponent(wabaId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                >
                  Manage on Meta <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Header */}
            <div className="space-y-2">
              <Label className="text-foreground">Header <span className="text-muted-foreground">(optional)</span></Label>
              <Select
                value={headerType}
                onValueChange={(v) => {
                  if (!v) return;
                  setHeaderType(v as HeaderType);
                  setHeaderHandle(''); setHeaderFileName(''); setHeaderText(''); setHeaderTextExample('');
                }}
              >
                <SelectTrigger className="w-full bg-accent border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="document">Document (PDF)</SelectItem>
                </SelectContent>
              </Select>

              {headerType === 'text' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={headerText}
                      onChange={(e) => setHeaderText(e.target.value)}
                      placeholder="Header text"
                      className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={headerHasVar}
                      onClick={() => setHeaderText((t) => `${t}${t ? ' ' : ''}{{1}}`)}
                      className="shrink-0 border-border text-foreground"
                      title="A text header may contain at most one variable"
                    >
                      <Plus className="h-4 w-4" /> Variable
                    </Button>
                  </div>
                  {headerHasVar && (
                    <Input
                      value={headerTextExample}
                      onChange={(e) => setHeaderTextExample(e.target.value)}
                      placeholder="Sample value for header {{1}}"
                      className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
                    />
                  )}
                </div>
              )}

              {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                <div className="space-y-1">
                  <Input
                    type="file"
                    accept={headerType === 'image' ? 'image/jpeg,image/png' : headerType === 'video' ? 'video/mp4' : 'application/pdf'}
                    onChange={(e) => handleHeaderFile(e.target.files?.[0] ?? null)}
                    disabled={uploadingHeader}
                    className="border-border bg-accent text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    {uploadingHeader
                      ? 'Uploading to Meta…'
                      : headerHandle
                        ? `✓ ${headerFileName} uploaded`
                        : 'Sample media Meta reviews the template with.'}
                  </p>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="space-y-2">
              <Label className="text-foreground">Body Text</Label>
              <Textarea
                ref={bodyRef}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={6}
                placeholder={'Hi {{1}}, your order {{2}} has shipped!'}
                className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-end gap-1">
                <Button type="button" variant="outline" onClick={() => wrapSelection('*')} className="h-8 w-8 border-border p-0 text-foreground" title="Bold"><Bold className="h-3.5 w-3.5" /></Button>
                <Button type="button" variant="outline" onClick={() => wrapSelection('_')} className="h-8 w-8 border-border p-0 text-foreground" title="Italic"><Italic className="h-3.5 w-3.5" /></Button>
                <Button type="button" variant="outline" onClick={() => wrapSelection('~')} className="h-8 w-8 border-border p-0 text-foreground" title="Strikethrough"><Strikethrough className="h-3.5 w-3.5" /></Button>
                <Button type="button" variant="outline" onClick={() => wrapSelection('```')} className="h-8 w-8 border-border p-0 text-foreground" title="Monospace"><Code className="h-3.5 w-3.5" /></Button>
                <Button type="button" onClick={addBodyVariable} className="h-8 bg-primary px-2 text-xs text-primary-foreground hover:bg-primary/90">
                  <Plus className="h-3.5 w-3.5" /> Add Variable
                </Button>
              </div>
              {bodyVars.length > 0 && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-foreground">Sample values <span className="text-muted-foreground">(required — Meta reviews a rendered example)</span></p>
                  {bodyVars.map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="w-14 shrink-0 font-mono text-xs text-primary">{'{{' + k + '}}'}</span>
                      <Input
                        value={bodyExamples[k] ?? ''}
                        onChange={(e) => setBodyExamples((s) => ({ ...s, [k]: e.target.value }))}
                        placeholder={k === '1' ? 'John' : 'Sample'}
                        className="h-8 border-border bg-accent text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="space-y-2">
              <Label className="text-foreground">Footer <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Reply STOP to unsubscribe"
                className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
              />
            </div>

            {/* Buttons */}
            <div className="space-y-2">
              <Label className="text-foreground">Buttons <span className="text-muted-foreground">(optional)</span></Label>
              {buttons.map((b, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">
                      {b.type === 'QUICK_REPLY' ? 'Quick Reply' : b.type === 'URL' ? 'URL' : b.type === 'DYNAMIC_URL' ? 'Dynamic URL' : b.type === 'PHONE_NUMBER' ? 'Phone Number' : 'Copy Code'}
                    </span>
                    <Button type="button" variant="outline" onClick={() => removeButton(i)} className="h-7 w-7 border-border p-0 text-red-400"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                  {b.type !== 'COPY_CODE' && (
                    <Input value={b.text} onChange={(e) => updateButton(i, { text: e.target.value })} placeholder="Button text" className="h-8 border-border bg-accent text-foreground placeholder:text-muted-foreground" />
                  )}
                  {(b.type === 'URL' || b.type === 'DYNAMIC_URL') && (
                    <Input value={b.url} onChange={(e) => updateButton(i, { url: e.target.value })} placeholder={b.type === 'DYNAMIC_URL' ? 'https://example.com  ( /{{1}} is appended )' : 'https://example.com/page'} className="h-8 border-border bg-accent text-foreground placeholder:text-muted-foreground" />
                  )}
                  {b.type === 'DYNAMIC_URL' && (
                    <Input value={b.example} onChange={(e) => updateButton(i, { example: e.target.value })} placeholder="Example full URL, e.g. https://example.com/orders/123" className="h-8 border-border bg-accent text-foreground placeholder:text-muted-foreground" />
                  )}
                  {b.type === 'PHONE_NUMBER' && (
                    <Input value={b.phone} onChange={(e) => updateButton(i, { phone: e.target.value })} placeholder="+919876543210" className="h-8 border-border bg-accent text-foreground placeholder:text-muted-foreground" />
                  )}
                  {b.type === 'COPY_CODE' && (
                    <Input value={b.example} onChange={(e) => updateButton(i, { example: e.target.value })} placeholder="Example code, e.g. SAVE20" className="h-8 border-border bg-accent text-foreground placeholder:text-muted-foreground" />
                  )}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={buttons.length >= MAX_BUTTONS} onClick={() => addButton('QUICK_REPLY')} className="h-8 border-border px-2 text-xs text-foreground"><Reply className="h-3.5 w-3.5" /> Quick Reply</Button>
                <Button type="button" variant="outline" disabled={buttons.length >= MAX_BUTTONS} onClick={() => addButton('URL')} className="h-8 border-border px-2 text-xs text-foreground"><Link2 className="h-3.5 w-3.5" /> URL</Button>
                <Button type="button" variant="outline" disabled={buttons.length >= MAX_BUTTONS} onClick={() => addButton('DYNAMIC_URL')} className="h-8 border-border px-2 text-xs text-foreground"><Link2 className="h-3.5 w-3.5" /> Dynamic URL</Button>
                <Button type="button" variant="outline" disabled={buttons.length >= MAX_BUTTONS} onClick={() => addButton('PHONE_NUMBER')} className="h-8 border-border px-2 text-xs text-foreground"><Phone className="h-3.5 w-3.5" /> Phone</Button>
                <Button type="button" variant="outline" disabled={buttons.length >= MAX_BUTTONS} onClick={() => addButton('COPY_CODE')} className="h-8 border-border px-2 text-xs text-foreground"><Copy className="h-3.5 w-3.5" /> Copy Code</Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-foreground">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting || uploadingHeader}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {submitting ? 'Submitting…' : 'Submit to Meta'}
              </Button>
            </div>
          </div>

          {/* ── Live preview ─────────────────────────────────── */}
          <div className="lg:col-span-2">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
            <div className="rounded-xl bg-[#0b141a] p-4">
              <div className="max-w-[280px] space-y-1 rounded-lg bg-[#202c33] p-2 text-[13px] text-[#e9edef] shadow">
                {headerType === 'text' && headerText && (
                  <p className="font-semibold">{withSamples(headerText, { '1': headerTextExample })}</p>
                )}
                {(headerType === 'image' || headerType === 'video' || headerType === 'document') && (
                  <div className="flex h-28 items-center justify-center rounded bg-[#111b21]">
                    {headerType === 'image' && <ImageIcon className="h-10 w-10 text-[#8696a0]" />}
                    {headerType === 'video' && <Play className="h-10 w-10 text-[#8696a0]" />}
                    {headerType === 'document' && <FileText className="h-10 w-10 text-[#8696a0]" />}
                  </div>
                )}
                <p className="whitespace-pre-line">
                  {withSamples(bodyText, bodyExamples) || 'Your message body appears here…'}
                </p>
                {footerText && <p className="text-[11px] text-[#8696a0]">{footerText}</p>}
                <p className="text-right text-[10px] text-[#8696a0]">
                  {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
                </p>
              </div>
              {buttons.length > 0 && (
                <div className="mt-1 max-w-[280px] divide-y divide-[#111b21] overflow-hidden rounded-lg bg-[#202c33]">
                  {buttons.map((b, i) => (
                    <div key={i} className="flex items-center justify-center gap-1.5 py-2 text-[13px] text-[#53bdeb]">
                      {b.type === 'QUICK_REPLY' && <Reply className="h-3.5 w-3.5" />}
                      {(b.type === 'URL' || b.type === 'DYNAMIC_URL') && <Link2 className="h-3.5 w-3.5" />}
                      {b.type === 'PHONE_NUMBER' && <Phone className="h-3.5 w-3.5" />}
                      {b.type === 'COPY_CODE' && <Copy className="h-3.5 w-3.5" />}
                      {b.type === 'COPY_CODE' ? 'Copy Code' : b.text || 'Button'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
