'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, IndianRupee } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { SUPPORTED_CURRENCIES } from '@/lib/billing/money';
import { buildUpiLink } from '@/lib/billing/invoice';

interface BillingSettings {
    currency: string;
    invoice_prefix: string;
    invoice_next_number: number;
    upi_vpa: string;
    upi_payee_name: string;
    payment_instructions: string;
}

const DEFAULTS: BillingSettings = {
    currency: 'INR',
    invoice_prefix: 'INV-',
    invoice_next_number: 1,
    upi_vpa: '',
    upi_payee_name: '',
    payment_instructions: '',
};

/**
 * Billing configuration. The UPI fields are the important ones: with a
 * VPA set, every invoice gets a working payment link without the
 * account signing up for a gateway.
 */
export function BillingPanel() {
    const supabase = createClient();
    const { user, loading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState<BillingSettings>(DEFAULTS);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            setLoading(false);
            return;
        }
        void (async () => {
            const { data, error } = await supabase
                .from('billing_settings')
                .select('*')
                .eq('user_id', user.id)
                .maybeSingle();
            setLoading(false);
            if (error) {
                toast.error('Failed to load billing settings');
                return;
            }
            if (data) {
                setSettings({
                    currency: data.currency,
                    invoice_prefix: data.invoice_prefix,
                    invoice_next_number: data.invoice_next_number,
                    upi_vpa: data.upi_vpa ?? '',
                    upi_payee_name: data.upi_payee_name ?? '',
                    payment_instructions: data.payment_instructions ?? '',
                });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user?.id]);

    async function handleSave() {
        if (!user) return;
        if (settings.invoice_next_number < 1) {
            toast.error('Next invoice number must be at least 1');
            return;
        }
        setSaving(true);
        const { error } = await supabase.from('billing_settings').upsert(
            {
                user_id: user.id,
                ...settings,
                upi_vpa: settings.upi_vpa.trim() || null,
                upi_payee_name: settings.upi_payee_name.trim() || null,
                payment_instructions: settings.payment_instructions.trim() || null,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
        );
        setSaving(false);
        if (error) {
            toast.error(`Failed to save: ${error.message}`);
            return;
        }
        toast.success('Billing settings saved');
    }

    // Live preview so a mistyped VPA is visible before an invoice goes
    // out with a broken link on it.
    const previewLink = buildUpiLink({
        vpa: settings.upi_vpa,
        payeeName: settings.upi_payee_name,
        amountMinor: 100000,
        note: `${settings.invoice_prefix}0001`,
    });

    if (loading) {
        return (
            <Card className="border-border bg-background">
                <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading billing settings…
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Card className="border-border bg-background">
                <CardContent className="space-y-4 pt-6">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <IndianRupee className="size-4 text-primary" />
                            Invoicing
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Numbers are allocated in sequence and can&apos;t collide, even when
                            two invoices are raised at the same moment.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Currency</Label>
                            <select
                                value={settings.currency}
                                onChange={(e) =>
                                    setSettings((p) => ({ ...p, currency: e.target.value }))
                                }
                                className="h-8 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground"
                            >
                                {SUPPORTED_CURRENCIES.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Number prefix</Label>
                            <Input
                                value={settings.invoice_prefix}
                                onChange={(e) =>
                                    setSettings((p) => ({ ...p, invoice_prefix: e.target.value }))
                                }
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Next number</Label>
                            <Input
                                type="number"
                                min={1}
                                value={settings.invoice_next_number}
                                onChange={(e) =>
                                    setSettings((p) => ({
                                        ...p,
                                        invoice_next_number: Number(e.target.value),
                                    }))
                                }
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-border bg-background">
                <CardContent className="space-y-3 pt-6">
                    <div>
                        <h3 className="text-sm font-medium text-foreground">UPI collection</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            With a VPA set, every invoice carries a UPI pay link — no gateway
                            account needed. An explicit payment link on an invoice overrides it.
                        </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">UPI ID (VPA)</Label>
                            <Input
                                value={settings.upi_vpa}
                                onChange={(e) =>
                                    setSettings((p) => ({ ...p, upi_vpa: e.target.value }))
                                }
                                placeholder="business@okhdfcbank"
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Payee name</Label>
                            <Input
                                value={settings.upi_payee_name}
                                onChange={(e) =>
                                    setSettings((p) => ({ ...p, upi_payee_name: e.target.value }))
                                }
                                placeholder="Bitlance Tech Hub"
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>

                    {previewLink && (
                        <p className="break-all rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground">
                            Preview (₹1,000): {previewLink}
                        </p>
                    )}

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                            Payment instructions
                        </Label>
                        <Textarea
                            value={settings.payment_instructions}
                            onChange={(e) =>
                                setSettings((p) => ({
                                    ...p,
                                    payment_instructions: e.target.value,
                                }))
                            }
                            rows={3}
                            placeholder="Bank transfer details, GST number, or 'please share a screenshot once paid'."
                            className="text-sm"
                        />
                    </div>
                </CardContent>
            </Card>

            <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                ) : (
                    <Save className="size-3.5" />
                )}
                Save billing settings
            </Button>
        </div>
    );
}
