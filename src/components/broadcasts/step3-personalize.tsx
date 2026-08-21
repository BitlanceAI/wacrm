'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { getTemplateHeaderRequirement } from '@/lib/whatsapp/template-capabilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, ArrowRight, Eye, GripVertical, Image as ImageIcon, Loader2, X } from 'lucide-react';

type VariableType = 'static' | 'field' | 'custom_field';

interface VariableMapping {
    type: VariableType;
    value: string;
}

interface Step3Props {
    template: MessageTemplate;
    variables: Record<string, VariableMapping>;
    onUpdate: (variables: Record<string, VariableMapping>) => void;
    /** Send-time header content (media URL or header-variable value). */
    headerValue: string;
    onHeaderValueChange: (value: string) => void;
    onNext: () => void;
    onBack: () => void;
}

const contactFields = [
    { value: 'name', label: 'Contact Name', icon: '👤' },
    { value: 'phone', label: 'Phone Number', icon: '📱' },
    { value: 'email', label: 'Email Address', icon: '✉️' },
    { value: 'company', label: 'Company', icon: '🏢' },
];

const SAMPLE_CONTACT: Contact = {
    id: 'sample',
    user_id: '',
    name: 'John Doe',
    phone: '+1234567890',
    email: 'john@example.com',
    company: 'Acme Corp',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
};

// Encode a chip's data as a JSON string for the drag payload
function encodeChip(type: VariableType, value: string, label: string) {
    return JSON.stringify({ type, value, label });
}
function decodeChip(raw: string): { type: VariableType; value: string; label: string } | null {
    try { return JSON.parse(raw); } catch { return null; }
}

export function Step3Personalize({
    template,
    variables,
    onUpdate,
    headerValue,
    onHeaderValueChange,
    onNext,
    onBack,
}: Step3Props) {
    // Media headers and header variables need send-time content that
    // Meta refuses to default — collect it here, one value for the
    // whole broadcast.
    const headerRequirement = getTemplateHeaderRequirement(template);
    const headerMissing =
        headerRequirement !== null && headerValue.trim() === '';
    const headerInvalid =
        headerRequirement?.kind === 'media' &&
        headerValue.trim() !== '' &&
        !/^https:\/\//i.test(headerValue.trim());
    const [customFields, setCustomFields] = useState<CustomField[]>([]);
    const [loadingFields, setLoadingFields] = useState(true);
    const [firstContact, setFirstContact] = useState<Contact | null>(null);
    const [firstContactCustomValues, setFirstContactCustomValues] = useState<Map<string, string>>(new Map());
    const [loadingPreview, setLoadingPreview] = useState(true);
    const [dragOver, setDragOver] = useState<string | null>(null); // key being hovered

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const supabase = createClient();
            const [fieldsRes, contactRes] = await Promise.all([
                supabase.from('custom_fields').select('*').order('field_name'),
                supabase
                    .from('contacts')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle(),
            ]);
            if (cancelled) return;

            setCustomFields(fieldsRes.data ?? []);
            setLoadingFields(false);

            const contact = contactRes.data ?? null;
            setFirstContact(contact);

            if (contact) {
                const { data: customVals } = await supabase
                    .from('contact_custom_values')
                    .select('custom_field_id, value')
                    .eq('contact_id', contact.id);
                if (!cancelled) {
                    const map = new Map<string, string>();
                    for (const row of customVals ?? []) {
                        map.set(row.custom_field_id, row.value ?? '');
                    }
                    setFirstContactCustomValues(map);
                }
            }
            setLoadingPreview(false);
        })();
        return () => { cancelled = true; };
    }, []);

    const placeholders = useMemo(() => {
        const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
        if (!matches) return [];
        return [...new Set(matches)].sort();
    }, [template.body_text]);

    const unmappedKeys = useMemo(() => {
        const missing: string[] = [];
        for (const placeholder of placeholders) {
            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
            const mapping = variables[key];
            if (!mapping || !mapping.value?.trim()) {
                missing.push(placeholder);
            }
        }
        return missing;
    }, [placeholders, variables]);

    function setMapping(key: string, type: VariableType, value: string) {
        onUpdate({ ...variables, [key]: { type, value } });
    }

    function clearMapping(key: string) {
        const next = { ...variables };
        delete next[key];
        onUpdate(next);
    }

    // Live preview
    const previewText = useMemo(() => {
        const contact = firstContact ?? SAMPLE_CONTACT;
        const customValues = firstContact ? firstContactCustomValues : new Map<string, string>();
        let text = template.body_text;
        for (const placeholder of placeholders) {
            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
            const mapping = variables[key];
            let replacement = placeholder;
            if (mapping) {
                if (mapping.type === 'static' && mapping.value) {
                    replacement = mapping.value;
                } else if (mapping.type === 'field' && mapping.value) {
                    const fieldMap: Record<string, string | undefined> = {
                        name: contact.name,
                        phone: contact.phone,
                        email: contact.email,
                        company: contact.company,
                    };
                    replacement = fieldMap[mapping.value] ?? placeholder;
                } else if (mapping.type === 'custom_field' && mapping.value) {
                    replacement = customValues.get(mapping.value) || placeholder;
                }
            }
            text = text.replaceAll(placeholder, replacement);
        }
        return text;
    }, [template.body_text, variables, placeholders, firstContact, firstContactCustomValues]);

    const previewLabel = firstContact ? (firstContact.name || firstContact.phone) : 'sample data';

    // Label lookup for a mapped variable (shown inside the drop zone)
    function getMappedLabel(key: string): string {
        const m = variables[key];
        if (!m) return '';
        if (m.type === 'static') return `"${m.value}"`;
        if (m.type === 'field') {
            return contactFields.find(f => f.value === m.value)?.label ?? m.value;
        }
        return customFields.find(f => f.id === m.value)?.field_name ?? m.value;
    }

    function getMappedIcon(key: string): string {
        const m = variables[key];
        if (!m) return '';
        if (m.type === 'static') return '✏️';
        if (m.type === 'field') return contactFields.find(f => f.value === m.value)?.icon ?? '•';
        return '🗂️';
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-foreground">Personalize Message</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Drag a field onto each <span className="font-mono text-primary">{'{{variable}}'}</span> slot to map it.
                </p>
            </div>

            {/* ── Header content (media URL / header variable) ──────── */}
            {headerRequirement && (
                <div className="rounded-xl border border-border bg-background/50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                        <ImageIcon className="h-4 w-4 text-primary" />
                        <p className="text-sm font-medium text-foreground">
                            {headerRequirement.kind === 'media'
                                ? `Header ${headerRequirement.mediaType}`
                                : 'Header variable'}
                        </p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {headerRequirement.kind === 'media'
                            ? `This template has a ${headerRequirement.mediaType} header. Paste a public https:// link — Meta downloads it for every recipient.`
                            : 'This template has a variable in its header. The value below is used for every recipient.'}
                    </p>
                    <Input
                        value={headerValue}
                        onChange={(e) => onHeaderValueChange(e.target.value)}
                        placeholder={
                            headerRequirement.kind === 'media'
                                ? `https://example.com/header.${headerRequirement.mediaType === 'image' ? 'jpg' : headerRequirement.mediaType === 'video' ? 'mp4' : 'pdf'}`
                                : 'Header text value'
                        }
                        className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
                    />
                    {headerInvalid && (
                        <p className="text-xs text-amber-400">
                            Must be a public https:// URL — Meta fetches it directly.
                        </p>
                    )}
                </div>
            )}

            {placeholders.length === 0 ? (
                <div className="rounded-xl border border-border bg-background/50 p-6 text-center">
                    <p className="text-sm text-muted-foreground">This template has no variables to personalize.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

                    {/* ── LEFT: Draggable field chips ──────────────────── */}
                    <div className="space-y-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available Fields</p>

                        {/* Contact fields */}
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">Contact Fields</p>
                            <div className="flex flex-wrap gap-2">
                                {contactFields.map((field) => (
                                    <div
                                        key={field.value}
                                        draggable
                                        onDragStart={(e) =>
                                            e.dataTransfer.setData('text/plain', encodeChip('field', field.value, field.label))
                                        }
                                        className="flex cursor-grab items-center gap-1.5 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm text-foreground shadow-sm transition-all active:cursor-grabbing active:scale-95 hover:border-primary/50 hover:bg-primary/10 hover:text-primary select-none"
                                    >
                                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                                        <span>{field.icon}</span>
                                        <span>{field.label}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Custom fields */}
                        {!loadingFields && customFields.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">Custom Fields</p>
                                <div className="flex flex-wrap gap-2">
                                    {customFields.map((f) => (
                                        <div
                                            key={f.id}
                                            draggable
                                            onDragStart={(e) =>
                                                e.dataTransfer.setData('text/plain', encodeChip('custom_field', f.id, f.field_name))
                                            }
                                            className="flex cursor-grab items-center gap-1.5 rounded-lg border border-border bg-accent px-3 py-1.5 text-sm text-foreground shadow-sm transition-all active:cursor-grabbing active:scale-95 hover:border-primary/50 hover:bg-primary/10 hover:text-primary select-none"
                                        >
                                            <GripVertical className="h-3 w-3 text-muted-foreground" />
                                            <span>🗂️</span>
                                            <span>{f.field_name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {loadingFields && (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading custom fields…
                            </div>
                        )}

                        {/* Static text chip */}
                        <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">Static Text</p>
                            <div
                                draggable
                                onDragStart={(e) =>
                                    e.dataTransfer.setData('text/plain', encodeChip('static', '__static__', 'Static Text'))
                                }
                                className="flex cursor-grab items-center gap-1.5 rounded-lg border border-dashed border-border bg-accent/50 px-3 py-1.5 text-sm text-muted-foreground transition-all active:cursor-grabbing active:scale-95 hover:border-primary/50 hover:text-primary select-none"
                            >
                                <GripVertical className="h-3 w-3" />
                                <span>✏️</span>
                                <span>Static Value</span>
                            </div>
                        </div>
                    </div>

                    {/* ── RIGHT: Drop zones for each placeholder ────────── */}
                    <div className="space-y-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Variable Slots</p>
                        {placeholders.map((placeholder) => {
                            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
                            const mapping = variables[key];
                            const isOver = dragOver === key;
                            const isMapped = !!(mapping?.value?.trim());

                            return (
                                <div key={placeholder} className="space-y-1">
                                    {/* Drop zone */}
                                    <div
                                        onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
                                        onDragLeave={() => setDragOver(null)}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            setDragOver(null);
                                            const raw = e.dataTransfer.getData('text/plain');
                                            const chip = decodeChip(raw);
                                            if (!chip) return;
                                            if (chip.type === 'static') {
                                                // start with empty static, user types in the input below
                                                setMapping(key, 'static', '');
                                            } else {
                                                setMapping(key, chip.type, chip.value);
                                            }
                                        }}
                                        className={[
                                            'relative flex min-h-[52px] items-center gap-3 rounded-xl border-2 px-4 py-3 transition-all',
                                            isOver
                                                ? 'border-primary bg-primary/10 shadow-md shadow-primary/20'
                                                : isMapped
                                                    ? 'border-primary/40 bg-primary/5'
                                                    : 'border-dashed border-border bg-background/30',
                                        ].join(' ')}
                                    >
                                        {/* Placeholder badge */}
                                        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
                                            {placeholder}
                                        </span>

                                        {isMapped ? (
                                            <>
                                                <span className="text-base">{getMappedIcon(key)}</span>
                                                <span className="flex-1 truncate text-sm font-medium text-foreground">
                                                    {getMappedLabel(key)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => clearMapping(key)}
                                                    className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground hover:bg-red-500/20 hover:text-red-400"
                                                    title="Remove mapping"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            </>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">
                                                {isOver ? '📌 Drop here' : 'Drag a field here…'}
                                            </span>
                                        )}
                                    </div>

                                    {/* Inline text input when static is mapped but value is still empty */}
                                    {mapping?.type === 'static' && (
                                        <Input
                                            autoFocus
                                            value={mapping.value}
                                            onChange={(e) => setMapping(key, 'static', e.target.value)}
                                            placeholder="Type the static value…"
                                            className="border-border bg-accent text-foreground placeholder:text-muted-foreground text-sm"
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Live Preview */}
            <div className="rounded-xl border border-border bg-background/50 p-4">
                <div className="mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium text-foreground">Live Preview</p>
                    <span className="text-xs text-muted-foreground">({previewLabel})</span>
                    {loadingPreview && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                </div>
                <div style={{ backgroundColor: '#0b141a', borderRadius: '8px', padding: '12px' }}>
                    <div
                        style={{
                            marginLeft: 'auto',
                            maxWidth: '85%',
                            backgroundColor: '#005c4b',
                            borderRadius: '8px',
                            padding: '8px 12px',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                        }}
                    >
                        <p style={{ whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: '1.5', color: '#e9edef', margin: 0 }}>
                            {previewText}
                        </p>
                        <div style={{ textAlign: 'right', marginTop: '4px' }}>
                            <span style={{ fontSize: '11px', color: '#8696a0' }}>
                                {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {unmappedKeys.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                    Map every placeholder before continuing — still missing{' '}
                    <span className="font-mono font-semibold">{unmappedKeys.join(', ')}</span>.
                </div>
            )}

            <div className="flex items-center justify-between border-t border-border pt-4">
                <Button variant="outline" onClick={onBack} className="border-border text-foreground">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
                <Button
                    onClick={onNext}
                    disabled={unmappedKeys.length > 0 || headerMissing || headerInvalid}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    Next
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}
