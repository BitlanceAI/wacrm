'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, RefreshCw, Pause, Play, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/billing/money';
import type { Contact, RenewalInterval, Subscription } from '@/types';

const INTERVALS: { value: RenewalInterval; label: string }[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' },
];

/**
 * Recurring plans. Renewal dates advance in the billing cron, not here
 * — this is purely the plan's definition and its pause/resume control.
 */
export function SubscriptionsPanel() {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name' | 'phone'>[]>([]);

    const [contactId, setContactId] = useState('');
    const [planName, setPlanName] = useState('');
    const [amount, setAmount] = useState('');
    const [interval, setIntervalValue] = useState<RenewalInterval>('monthly');
    const [nextDate, setNextDate] = useState('');
    const [autoInvoice, setAutoInvoice] = useState(false);

    /**
     * Non-async on purpose, with the state updates inside .then():
     * React's cascading-render rule treats an awaited setState in a
     * function called straight from an effect as a synchronous one, and
     * this is the shape the dashboard loader already uses.
     */
    const load = useCallback(() => {
        return fetch('/api/subscriptions')
            .then(async (res) => (res.ok ? await res.json() : null))
            .then((data) => {
                setLoading(false);
                if (!data) {
                    toast.error('Failed to load subscriptions');
                    return;
                }
                setSubscriptions(data.subscriptions ?? []);
            })
            .catch(() => {
                setLoading(false);
                toast.error('Failed to load subscriptions');
            });
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!dialogOpen || contacts.length > 0) return;
        void (async () => {
            const supabase = createClient();
            const { data } = await supabase
                .from('contacts')
                .select('id, name, phone')
                .order('name')
                .limit(500);
            setContacts(data ?? []);
        })();
    }, [dialogOpen, contacts.length]);

    async function handleCreate() {
        if (!contactId || !planName.trim() || !amount.trim() || !nextDate) {
            toast.error('Contact, plan, amount and next renewal date are required');
            return;
        }
        setSaving(true);
        const res = await fetch('/api/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: contactId,
                plan_name: planName.trim(),
                amount: amount.trim(),
                interval,
                next_renewal_date: nextDate,
                auto_invoice: autoInvoice,
            }),
        });
        setSaving(false);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(data.error ?? 'Failed to create subscription');
            return;
        }
        toast.success('Subscription created');
        setDialogOpen(false);
        setPlanName('');
        setAmount('');
        void load();
    }

    async function patch(id: string, body: Record<string, unknown>) {
        const res = await fetch('/api/subscriptions', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, ...body }),
        });
        if (!res.ok) {
            toast.error('Failed to update subscription');
            return;
        }
        void load();
    }

    async function remove(id: string) {
        const res = await fetch(`/api/subscriptions?id=${id}`, { method: 'DELETE' });
        if (!res.ok) {
            toast.error('Failed to delete subscription');
            return;
        }
        setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    }

    return (
        <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    Renewal dates roll forward automatically. Plans marked
                    &ldquo;auto-invoice&rdquo; raise a draft invoice on each renewal — off by
                    default, because nobody should be billed by accident.
                </p>
                <Button size="sm" onClick={() => setDialogOpen(true)} className="shrink-0">
                    <Plus className="size-3.5" />
                    New plan
                </Button>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading plans…
                </div>
            ) : subscriptions.length === 0 ? (
                <div className="rounded-xl border border-border bg-background py-12 text-center">
                    <RefreshCw className="mx-auto size-7 text-muted-foreground" />
                    <p className="mt-3 text-sm text-foreground">No recurring plans yet</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {subscriptions.map((sub) => (
                        <div
                            key={sub.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                        {sub.plan_name}
                                    </span>
                                    <span
                                        className={cn(
                                            'rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                                            sub.status === 'active'
                                                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                                                : 'border-border bg-slate-500/10 text-muted-foreground',
                                        )}
                                    >
                                        {sub.status}
                                    </span>
                                    {sub.auto_invoice && (
                                        <span className="rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
                                            auto-invoice
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {sub.contact?.name || sub.contact?.phone || 'Unknown'}
                                    {' · '}
                                    <span className="font-medium text-foreground">
                                        {formatMoney(sub.amount_minor, sub.currency)}
                                    </span>
                                    {` ${sub.interval} · next ${sub.next_renewal_date}`}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() =>
                                        patch(sub.id, {
                                            status: sub.status === 'active' ? 'paused' : 'active',
                                        })
                                    }
                                >
                                    {sub.status === 'active' ? (
                                        <>
                                            <Pause className="size-3.5" />
                                            Pause
                                        </>
                                    ) : (
                                        <>
                                            <Play className="size-3.5" />
                                            Resume
                                        </>
                                    )}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0 text-muted-foreground hover:text-red-400"
                                    onClick={() => remove(sub.id)}
                                    aria-label={`Delete ${sub.plan_name}`}
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>New recurring plan</DialogTitle>
                        <DialogDescription>
                            Renewals on the 31st fall back to the last day of shorter months
                            rather than skipping a cycle.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Contact</Label>
                            <select
                                value={contactId}
                                onChange={(e) => setContactId(e.target.value)}
                                className="h-8 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground"
                            >
                                <option value="">Select a contact…</option>
                                {contacts.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name || c.phone}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Plan name</Label>
                            <Input
                                value={planName}
                                onChange={(e) => setPlanName(e.target.value)}
                                placeholder="Gold membership"
                                className="h-8 text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Amount</Label>
                                <Input
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    inputMode="decimal"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Interval</Label>
                                <select
                                    value={interval}
                                    onChange={(e) =>
                                        setIntervalValue(e.target.value as RenewalInterval)
                                    }
                                    className="h-8 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground"
                                >
                                    {INTERVALS.map((i) => (
                                        <option key={i.value} value={i.value}>
                                            {i.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Next renewal</Label>
                                <Input
                                    type="date"
                                    value={nextDate}
                                    onChange={(e) => setNextDate(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-border p-3">
                            <div>
                                <p className="text-sm text-foreground">Auto-invoice on renewal</p>
                                <p className="text-xs text-muted-foreground">
                                    Raises a draft invoice each cycle. You still choose when to send
                                    it.
                                </p>
                            </div>
                            <Switch checked={autoInvoice} onCheckedChange={setAutoInvoice} />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={saving}>
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
