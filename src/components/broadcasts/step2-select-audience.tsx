'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
    Users,
    Tags,
    Filter,
    Upload,
    Loader2,
    ArrowRight,
    ArrowLeft,
    X,
} from 'lucide-react';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
    fieldId: string;
    operator: CustomFieldOperator;
    value: string;
}

interface AudienceConfig {
    type: AudienceType;
    tagIds?: string[];
    customField?: CustomFieldFilter;
    /** Each CSV row can carry per-contact variable values keyed by their
     * 1-based index string (e.g. "1", "2", "3") so the send loop can
     * substitute them instead of falling back to a field mapping. */
    csvContacts?: { phone: string; name?: string; vars?: Record<string, string> }[];
    excludeTagIds?: string[];
}

interface Step2Props {
    audience: AudienceConfig;
    onUpdate: (audience: AudienceConfig) => void;
    onNext: () => void;
    onBack: () => void;
}

const audienceOptions: {
    type: AudienceType;
    label: string;
    description: string;
    icon: typeof Users;
}[] = [
        {
            type: 'all',
            label: 'All Contacts',
            description: 'Send to every contact in your database',
            icon: Users,
        },
        {
            type: 'tags',
            label: 'Filter by Tags',
            description: 'Target contacts with specific tags',
            icon: Tags,
        },
        {
            type: 'custom_field',
            label: 'Custom Field',
            description: 'Filter by a custom field value',
            icon: Filter,
        },
        {
            type: 'csv',
            label: 'Upload CSV / Excel',
            description: 'Upload phone + variable columns (var1, var2…)',
            icon: Upload,
        },
    ];

const OPERATOR_OPTIONS: { value: CustomFieldOperator; label: string }[] = [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
];

export function Step2SelectAudience({
    audience,
    onUpdate,
    onNext,
    onBack,
}: Step2Props) {
    const [tags, setTags] = useState<Tag[]>([]);
    const [customFields, setCustomFields] = useState<CustomField[]>([]);
    const [loadingTags, setLoadingTags] = useState(false);
    const [loadingFields, setLoadingFields] = useState(false);
    const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
    const [loadingCount, setLoadingCount] = useState(false);

    // Tags are used both by the primary "Filter by Tags" audience type
    // AND by the exclude-list below — so always load once on mount.
    useEffect(() => {
        async function fetchTags() {
            setLoadingTags(true);
            try {
                const supabase = createClient();
                const { data } = await supabase.from('tags').select('*').order('name');
                setTags(data ?? []);
            } finally {
                setLoadingTags(false);
            }
        }
        fetchTags();
    }, []);

    // Lazy-load custom fields only when that audience type is active.
    useEffect(() => {
        if (audience.type !== 'custom_field') return;
        async function fetchFields() {
            setLoadingFields(true);
            try {
                const supabase = createClient();
                const { data } = await supabase
                    .from('custom_fields')
                    .select('*')
                    .order('field_name');
                setCustomFields(data ?? []);
            } finally {
                setLoadingFields(false);
            }
        }
        fetchFields();
    }, [audience.type]);

    const fetchEstimatedCount = useCallback(async () => {
        setLoadingCount(true);
        try {
            const supabase = createClient();

            // Base query — produces the superset before exclude is applied.
            let baseIds: Set<string> | null = null; // null means "all contacts"

            if (audience.type === 'all') {
                // Handled below — full-table count adjusted by excludes.
            } else if (
                audience.type === 'tags' &&
                audience.tagIds &&
                audience.tagIds.length > 0
            ) {
                const { data } = await supabase
                    .from('contact_tags')
                    .select('contact_id')
                    .in('tag_id', audience.tagIds);
                baseIds = new Set((data ?? []).map((r) => r.contact_id));
            } else if (
                audience.type === 'custom_field' &&
                audience.customField?.fieldId &&
                audience.customField.value
            ) {
                const { fieldId, operator, value } = audience.customField;
                let q = supabase
                    .from('contact_custom_values')
                    .select('contact_id')
                    .eq('custom_field_id', fieldId);
                if (operator === 'is') q = q.eq('value', value);
                else if (operator === 'is_not') q = q.neq('value', value);
                else q = q.ilike('value', `%${value}%`);
                const { data } = await q;
                baseIds = new Set((data ?? []).map((r) => r.contact_id));
            } else if (
                audience.type === 'csv' &&
                audience.csvContacts &&
                audience.csvContacts.length > 0
            ) {
                setEstimatedCount(audience.csvContacts.length);
                return;
            } else {
                // Partially-configured audience — wait for the user to finish.
                setEstimatedCount(null);
                return;
            }

            // Apply exclude tags
            let excludeSet: Set<string> | null = null;
            if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
                const { data: excludeRows } = await supabase
                    .from('contact_tags')
                    .select('contact_id')
                    .in('tag_id', audience.excludeTagIds);
                excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
            }

            if (baseIds) {
                const effective = [...baseIds].filter(
                    (id) => !excludeSet?.has(id),
                );
                setEstimatedCount(effective.length);
            } else {
                // "All" — fetch the total, then subtract exclude set if any.
                const { count } = await supabase
                    .from('contacts')
                    .select('*', { count: 'exact', head: true });
                const total = count ?? 0;
                setEstimatedCount(excludeSet ? Math.max(0, total - excludeSet.size) : total);
            }
        } finally {
            setLoadingCount(false);
        }
    }, [
        audience.type,
        audience.tagIds,
        audience.customField,
        audience.csvContacts,
        audience.excludeTagIds,
    ]);

    useEffect(() => {
        fetchEstimatedCount();
    }, [fetchEstimatedCount]);

    function toggleTag(tagId: string) {
        const current = audience.tagIds ?? [];
        const updated = current.includes(tagId)
            ? current.filter((id) => id !== tagId)
            : [...current, tagId];
        onUpdate({ ...audience, tagIds: updated });
    }

    function toggleExcludeTag(tagId: string) {
        const current = audience.excludeTagIds ?? [];
        const updated = current.includes(tagId)
            ? current.filter((id) => id !== tagId)
            : [...current, tagId];
        onUpdate({ ...audience, excludeTagIds: updated });
    }

    function updateCustomField(patch: Partial<CustomFieldFilter>) {
        const prev = audience.customField ?? {
            fieldId: '',
            operator: 'is' as CustomFieldOperator,
            value: '',
        };
        onUpdate({ ...audience, customField: { ...prev, ...patch } });
    }

    const isValid =
        audience.type === 'all' ||
        (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) ||
        (audience.type === 'custom_field' &&
            !!audience.customField?.fieldId &&
            audience.customField.value.length > 0) ||
        (audience.type === 'csv' &&
            audience.csvContacts &&
            audience.csvContacts.length > 0);

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-lg font-semibold text-foreground">Select Audience</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                    Choose who will receive this broadcast.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {audienceOptions.map((option) => {
                    const isSelected = audience.type === option.type;
                    const Icon = option.icon;
                    return (
                        <button
                            key={option.type}
                            onClick={() =>
                                onUpdate({
                                    ...audience,
                                    type: option.type,
                                    // Wipe shape fields from other types to avoid stale
                                    // config leaking across selections.
                                    tagIds: option.type === 'tags' ? audience.tagIds : undefined,
                                    customField:
                                        option.type === 'custom_field'
                                            ? audience.customField
                                            : undefined,
                                    csvContacts:
                                        option.type === 'csv' ? audience.csvContacts : undefined,
                                })
                            }
                            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${isSelected
                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                                    : 'border-border bg-background/50 hover:border-border'
                                }`}
                        >
                            <div
                                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${isSelected
                                        ? 'bg-primary/10 text-primary'
                                        : 'bg-accent text-muted-foreground'
                                    }`}
                            >
                                <Icon className="h-4 w-4" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-foreground">{option.label}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {option.description}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>

            {audience.type === 'tags' && (
                <div className="rounded-xl border border-border bg-background/50 p-4">
                    <p className="mb-3 text-sm font-medium text-foreground">Select Tags</p>
                    {loadingTags ? (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : tags.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            No tags found. Create tags in Settings.
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {tags.map((tag) => {
                                const isSelected = audience.tagIds?.includes(tag.id);
                                return (
                                    <button
                                        key={tag.id}
                                        onClick={() => toggleTag(tag.id)}
                                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${isSelected
                                                ? 'border-primary/30 bg-primary/10 text-primary'
                                                : 'border-border bg-accent text-foreground hover:border-border'
                                            }`}
                                    >
                                        <span
                                            className="mr-1.5 h-2 w-2 rounded-full"
                                            style={{ backgroundColor: tag.color }}
                                        />
                                        {tag.name}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {audience.type === 'custom_field' && (
                <div className="space-y-3 rounded-xl border border-border bg-background/50 p-4">
                    <p className="text-sm font-medium text-foreground">Custom Field Filter</p>
                    {loadingFields ? (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : customFields.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                            No custom fields defined. Create one in Settings → Custom Fields.
                        </p>
                    ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
                            <select
                                value={audience.customField?.fieldId ?? ''}
                                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                                className="h-9 rounded-lg border border-border bg-accent px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                            >
                                <option value="">Select field…</option>
                                {customFields.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.field_name}
                                    </option>
                                ))}
                            </select>
                            <select
                                value={audience.customField?.operator ?? 'is'}
                                onChange={(e) =>
                                    updateCustomField({
                                        operator: e.target.value as CustomFieldOperator,
                                    })
                                }
                                className="h-9 rounded-lg border border-border bg-accent px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                            >
                                {OPERATOR_OPTIONS.map((op) => (
                                    <option key={op.value} value={op.value}>
                                        {op.label}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="text"
                                value={audience.customField?.value ?? ''}
                                onChange={(e) => updateCustomField({ value: e.target.value })}
                                placeholder="Value"
                                className="h-9 rounded-lg border border-border bg-accent px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                            />
                        </div>
                    )}
                </div>
            )}

            {audience.type === 'csv' && (
                <CsvUploadSection
                    csvContacts={audience.csvContacts ?? []}
                    onChange={(contacts) => onUpdate({ ...audience, csvContacts: contacts })}
                />
            )}

            {/* Exclude list — applies regardless of audience type */}
            <div className="rounded-xl border border-border bg-background/50 p-4">
                <div className="mb-3 flex items-center gap-2">
                    <X className="h-4 w-4 text-red-400" />
                    <p className="text-sm font-medium text-foreground">
                        Exclude contacts with these tags
                    </p>
                    <span className="text-xs text-muted-foreground">(optional)</span>
                </div>
                {tags.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tags available.</p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {tags.map((tag) => {
                            const isExcluded = audience.excludeTagIds?.includes(tag.id);
                            return (
                                <button
                                    key={tag.id}
                                    onClick={() => toggleExcludeTag(tag.id)}
                                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${isExcluded
                                            ? 'border-red-500/30 bg-red-500/10 text-red-300'
                                            : 'border-border bg-accent text-foreground hover:border-border'
                                        }`}
                                >
                                    <span
                                        className="mr-1.5 h-2 w-2 rounded-full"
                                        style={{ backgroundColor: tag.color }}
                                    />
                                    {tag.name}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Audience Summary */}
            <div className="rounded-xl border border-border bg-background/50 p-4">
                <p className="mb-2 text-sm font-medium text-foreground">Audience Summary</p>
                {loadingCount ? (
                    <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-xs text-muted-foreground">Calculating…</span>
                    </div>
                ) : estimatedCount !== null ? (
                    <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-sm text-foreground">
                            {estimatedCount.toLocaleString()}
                        </span>
                        <span className="text-xs text-muted-foreground">estimated recipients</span>
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Select an audience type to see the estimate.
                    </p>
                )}
            </div>

            <div className="flex items-center justify-between border-t border-border pt-4">
                <Button
                    variant="outline"
                    onClick={onBack}
                    className="border-border text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </Button>
                <Button
                    onClick={onNext}
                    disabled={!isValid}
                    className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                    Next
                    <ArrowRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// CsvUploadSection — smart CSV/Excel parser that auto-detects variable columns
// ─────────────────────────────────────────────────────────────────────────────

type CsvContact = { phone: string; name?: string; vars?: Record<string, string> };

interface CsvUploadSectionProps {
    csvContacts: CsvContact[];
    onChange: (contacts: CsvContact[]) => void;
}

/**
 * Normalise a raw CSV header to detect which template variable it targets.
 * Accepts: "var1", "var 1", "{{1}}", "1", "variable1", "v1", "col1" etc.
 * Returns the 1-based index as a string ("1","2",…) or null if not a var col.
 */
function detectVarIndex(header: string): string | null {
    const h = header.trim().toLowerCase().replace(/\s+/g, '');
    // {{1}}, {{2}}, …
    const doubleBrace = h.match(/^\{\{(\d+)\}\}$/);
    if (doubleBrace) return doubleBrace[1];
    // var1, variable1, v1, col1, param1
    const prefixed = h.match(/^(?:var(?:iable)?|v|col|param)(\d+)$/);
    if (prefixed) return prefixed[1];
    // bare "1", "2", …
    if (/^\d+$/.test(h)) return h;
    return null;
}

function parseCsv(text: string): CsvContact[] {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));

    // Find the phone column (first match wins)
    const phoneIdx = headers.findIndex((h) =>
        /^(phone|mobile|number|whatsapp|tel|msisdn)$/i.test(h.replace(/\s+/g, ''))
    );
    if (phoneIdx === -1) return []; // no phone column

    // Find name column
    const nameIdx = headers.findIndex((h) =>
        /^(name|full_?name|contact_?name|customer_?name)$/i.test(h.replace(/\s+/g, ''))
    );

    // Find variable columns — { colIndex → varKey }
    const varCols: { colIndex: number; varKey: string }[] = [];
    headers.forEach((h, i) => {
        if (i === phoneIdx || i === nameIdx) return;
        const key = detectVarIndex(h);
        if (key) varCols.push({ colIndex: i, varKey: key });
    });

    const contacts: CsvContact[] = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const phone = cols[phoneIdx]?.trim();
        if (!phone) continue;

        const vars: Record<string, string> = {};
        for (const { colIndex, varKey } of varCols) {
            vars[varKey] = cols[colIndex]?.trim() ?? '';
        }

        contacts.push({
            phone,
            name: nameIdx >= 0 ? cols[nameIdx]?.trim() || undefined : undefined,
            vars: Object.keys(vars).length > 0 ? vars : undefined,
        });
    }
    return contacts;
}

function downloadTemplate(varCount = 4) {
    const headers = ['phone', 'name', ...Array.from({ length: varCount }, (_, i) => `var${i + 1}`)];
    const example = ['+919876543210', 'Rahul', ...Array.from({ length: varCount }, (_, i) => `Value${i + 1}`)];
    const csv = [headers.join(','), example.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'broadcast_template.csv';
    a.click();
    URL.revokeObjectURL(url);
}

function CsvUploadSection({ csvContacts, onChange }: CsvUploadSectionProps) {
    const [error, setError] = useState<string | null>(null);
    const [detectedVarKeys, setDetectedVarKeys] = useState<string[]>([]);

    function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        setError(null);

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target?.result as string;
            const parsed = parseCsv(text);
            if (parsed.length === 0) {
                setError('No valid rows found. Make sure the file has a "phone" column header.');
                return;
            }
            // Collect the union of all var keys detected across rows
            const allKeys = new Set<string>();
            parsed.forEach((c) => Object.keys(c.vars ?? {}).forEach((k) => allKeys.add(k)));
            setDetectedVarKeys([...allKeys].sort((a, b) => Number(a) - Number(b)));
            onChange(parsed);
        };
        reader.readAsText(file);
        // Reset input so the same file can be re-uploaded after edits
        e.target.value = '';
    }

    const preview = csvContacts.slice(0, 5);
    const allVarKeys = detectedVarKeys.length > 0
        ? detectedVarKeys
        : [...new Set(csvContacts.flatMap((c) => Object.keys(c.vars ?? {})))]
              .sort((a, b) => Number(a) - Number(b));

    return (
        <div className="rounded-xl border border-border bg-background/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-medium text-foreground">Upload CSV File</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Required column: <code className="bg-accent px-1 rounded">phone</code>.
                        Optional: <code className="bg-accent px-1 rounded">name</code>,{' '}
                        <code className="bg-accent px-1 rounded">var1</code>,{' '}
                        <code className="bg-accent px-1 rounded">var2</code>,{' '}
                        <code className="bg-accent px-1 rounded">var3</code>… or{' '}
                        <code className="bg-accent px-1 rounded">{'{{1}}'}</code>,{' '}
                        <code className="bg-accent px-1 rounded">{'{{2}}'}</code>…
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => downloadTemplate(4)}
                    className="shrink-0 text-xs text-primary hover:underline"
                >
                    ↓ Download template
                </button>
            </div>

            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-accent/30 py-8 text-center transition-colors hover:border-primary/50 hover:bg-accent/50">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                    {csvContacts.length > 0 ? 'Replace file' : 'Click to upload CSV'}
                </span>
                <span className="text-xs text-muted-foreground">CSV files only</span>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={handleFile}
                />
            </label>

            {error && (
                <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}

            {csvContacts.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium text-foreground">
                            {csvContacts.length.toLocaleString()} contacts loaded
                        </span>
                        {allVarKeys.length > 0 && (
                            <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                                {allVarKeys.length} variable{allVarKeys.length > 1 ? 's' : ''} detected ({allVarKeys.map(k => `{{${k}}}`).join(', ')})
                            </span>
                        )}
                    </div>

                    {/* Preview table */}
                    <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                            <thead className="bg-accent text-muted-foreground">
                                <tr>
                                    <th className="px-3 py-2 text-left font-medium">Phone</th>
                                    <th className="px-3 py-2 text-left font-medium">Name</th>
                                    {allVarKeys.map((k) => (
                                        <th key={k} className="px-3 py-2 text-left font-medium">{`{{${k}}}`}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {preview.map((c, i) => (
                                    <tr key={i} className="border-t border-border">
                                        <td className="px-3 py-1.5 font-mono text-foreground">{c.phone}</td>
                                        <td className="px-3 py-1.5 text-foreground">{c.name ?? '—'}</td>
                                        {allVarKeys.map((k) => (
                                            <td key={k} className="px-3 py-1.5 text-foreground">{c.vars?.[k] ?? '—'}</td>
                                        ))}
                                    </tr>
                                ))}
                                {csvContacts.length > 5 && (
                                    <tr className="border-t border-border">
                                        <td colSpan={2 + allVarKeys.length} className="px-3 py-1.5 text-muted-foreground">
                                            … and {csvContacts.length - 5} more rows
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
