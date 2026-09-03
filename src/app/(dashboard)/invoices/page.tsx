'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    Receipt,
    Loader2,
    Plus,
    Send,
    Check,
    Ban,
    Trash2,
    ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SubscriptionsPanel } from '@/components/billing/subscriptions-panel';
import type { Contact, Invoice, InvoiceStatus } from '@/types';

const STATUS_STYLES: Record<InvoiceStatus, string> = {
    draft: 'bg-slate-500/10 text-muted-foreground border-border',
    sent: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    paid: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    overdue: 'bg-red-500/10 text-red-400 border-red-500/20',
    void: 'bg-slate-500/10 text-slate-500 border-border',
    refunded: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

export default function InvoicesPage() {
    const [invoices, setInvoices] = useState<Invoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name' | 'phone'>[]>([]);

    const [contactId, setContactId] = useState('');
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [notes, setNotes] = useState('');

    /**
     * Non-async on purpose, with the state updates inside .then():
     * React's cascading-render rule treats an awaited setState in a
     * function called straight from an effect as a synchronous one, and
     * this is the shape the dashboard loader already uses.
     */
    const load = useCallback(() => {
        return fetch('/api/invoices')
            .then(async (res) => (res.ok ? await res.json() : null))
            .then((data) => {
                setLoading(false);
                if (!data) {
                    toast.error('Failed to load invoices');
                    return;
                }
                setInvoices(data.invoices ?? []);
            })
            .catch(() => {
                setLoading(false);
                toast.error('Failed to load invoices');
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
        if (!contactId || !description.trim() || !amount.trim()) {
            toast.error('Contact, description and amount are required');
            return;
        }
        setSaving(true);
        const res = await fetch('/api/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: contactId,
                description: description.trim(),
                amount: amount.trim(),
                due_date: dueDate || null,
                notes: notes.trim() || null,
            }),
        });
        setSaving(false);

        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 207) {
            toast.error(data.error ?? 'Failed to create invoice');
            return;
        }
        if (data.warning) toast.warning(data.warning);
        else
            toast.success(
                `Invoice ${data.invoice.number} created — ${data.reminders_created} reminder(s) scheduled`,
            );

        setDialogOpen(false);
        setDescription('');
        setAmount('');
        setDueDate('');
        setNotes('');
        void load();
    }

    async function send(invoice: Invoice) {
        setBusyId(invoice.id);
        const res = await fetch(`/api/invoices/${invoice.id}/send`, { method: 'POST' });
        setBusyId(null);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(data.error ?? 'Failed to send invoice');
            return;
        }
        toast.success(`Invoice ${invoice.number} sent`);
        void load();
    }

    async function setStatus(invoice: Invoice, status: InvoiceStatus) {
        setBusyId(invoice.id);
        const res = await fetch(`/api/invoices/${invoice.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        setBusyId(null);
        if (!res.ok) {
            toast.error('Failed to update invoice');
            return;
        }
        toast.success(
            status === 'paid'
                ? `${invoice.number} marked paid — pending reminders cancelled`
                : `${invoice.number} marked ${status}`,
        );
        void load();
    }

    async function remove(invoice: Invoice) {
        const res = await fetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' });
        if (!res.ok) {
            toast.error('Failed to delete invoice');
            return;
        }
        setInvoices((prev) => prev.filter((i) => i.id !== invoice.id));
    }

    const outstanding = invoices
        .filter((i) => i.status === 'sent' || i.status === 'overdue')
        .reduce((sum, i) => sum + i.amount_minor, 0);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Invoices</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Bill customers over WhatsApp with a payment link and an automatic
                        chase schedule. Marking one paid cancels its pending reminders.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {outstanding > 0 && (
                        <div className="text-right">
                            <p className="text-xs text-muted-foreground">Outstanding</p>
                            <p className="text-sm font-semibold text-foreground">
                                {formatMoney(outstanding, invoices[0]?.currency ?? 'INR')}
                            </p>
                        </div>
                    )}
                    <Button size="sm" onClick={() => setDialogOpen(true)}>
                        <Plus className="size-3.5" />
                        New invoice
                    </Button>
                </div>
            </div>

            <Tabs defaultValue="invoices">
                <TabsList className="border border-border bg-background">
                    <TabsTrigger
                        value="invoices"
                        className="text-muted-foreground data-active:bg-accent data-active:text-primary"
                    >
                        Invoices
                    </TabsTrigger>
                    <TabsTrigger
                        value="subscriptions"
                        className="text-muted-foreground data-active:bg-accent data-active:text-primary"
                    >
                        Recurring plans
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="invoices" className="space-y-2 pt-3">
            {loading ? (
                <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading invoices…
                </div>
            ) : invoices.length === 0 ? (
                <div className="rounded-xl border border-border bg-background py-16 text-center">
                    <Receipt className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm text-foreground">No invoices yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Add your UPI ID in Settings → Billing and every invoice gets a pay
                        link automatically.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {invoices.map((invoice) => (
                        <div
                            key={invoice.id}
                            className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-background p-4"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono text-xs text-muted-foreground">
                                        {invoice.number}
                                    </span>
                                    <span className="text-sm font-medium text-foreground">
                                        {invoice.description}
                                    </span>
                                    <span
                                        className={cn(
                                            'rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize',
                                            STATUS_STYLES[invoice.status],
                                        )}
                                    >
                                        {invoice.status}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {invoice.contact?.name || invoice.contact?.phone || 'Unknown'}
                                    {' · '}
                                    <span className="font-medium text-foreground">
                                        {formatMoney(invoice.amount_minor, invoice.currency)}
                                    </span>
                                    {invoice.due_date && ` · due ${invoice.due_date}`}
                                </p>
                                {invoice.payment_url && (
                                    <a
                                        href={invoice.payment_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                                    >
                                        <ExternalLink className="size-3" />
                                        Payment link
                                    </a>
                                )}
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                {invoice.status !== 'paid' && invoice.status !== 'void' && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs"
                                            disabled={busyId === invoice.id}
                                            onClick={() => send(invoice)}
                                        >
                                            {busyId === invoice.id ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <Send className="size-3.5" />
                                            )}
                                            Send
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs text-emerald-400"
                                            disabled={busyId === invoice.id}
                                            onClick={() => setStatus(invoice, 'paid')}
                                        >
                                            <Check className="size-3.5" />
                                            Paid
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs text-muted-foreground"
                                            disabled={busyId === invoice.id}
                                            onClick={() => setStatus(invoice, 'void')}
                                        >
                                            <Ban className="size-3.5" />
                                            Void
                                        </Button>
                                    </>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0 text-muted-foreground hover:text-red-400"
                                    onClick={() => remove(invoice)}
                                    aria-label={`Delete ${invoice.number}`}
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

                </TabsContent>

                <TabsContent value="subscriptions" className="pt-3">
                    <SubscriptionsPanel />
                </TabsContent>
            </Tabs>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>New invoice</DialogTitle>
                        <DialogDescription>
                            The number is allocated automatically. With a due date set, the
                            default chase schedule is 3 days before, then 1 and 7 days after.
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
                            <Label className="text-xs text-muted-foreground">Description</Label>
                            <Input
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="August retainer"
                                className="h-8 text-sm"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Amount</Label>
                                <Input
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="5000"
                                    inputMode="decimal"
                                    className="h-8 text-sm"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Due date</Label>
                                <Input
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Notes</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                className="text-sm"
                            />
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
