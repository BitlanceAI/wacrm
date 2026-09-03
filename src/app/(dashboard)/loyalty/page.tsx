'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Award, Ticket, Loader2, Plus, Trash2, Minus } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
import {
    tierForPoints,
    pointsToNextTier,
    couponRejection,
    normalizeCouponCode,
} from '@/lib/retention/loyalty';
import type { Contact } from '@/types';
import { ConnectRequiredBanner } from '@/components/whatsapp/connect-required-banner';

interface LoyaltyAccount {
    id: string;
    contact_id: string;
    points_balance: number;
    lifetime_points: number;
    contact?: Pick<Contact, 'id' | 'name' | 'phone'>;
}

interface Coupon {
    id: string;
    code: string;
    description?: string | null;
    discount_type: 'percent' | 'fixed';
    discount_value: number;
    currency: string;
    max_redemptions?: number | null;
    redeemed_count: number;
    once_per_contact: boolean;
    starts_at?: string | null;
    expires_at?: string | null;
    active: boolean;
}

export default function LoyaltyPage() {
    const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
    const [coupons, setCoupons] = useState<Coupon[]>([]);
    const [loading, setLoading] = useState(true);
    const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name' | 'phone'>[]>([]);

    const [pointsDialogOpen, setPointsDialogOpen] = useState(false);
    const [couponDialogOpen, setCouponDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    const [contactId, setContactId] = useState('');
    const [points, setPoints] = useState('');
    const [reason, setReason] = useState('');

    const [code, setCode] = useState('');
    const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
    const [discountValue, setDiscountValue] = useState('10');
    const [expiresAt, setExpiresAt] = useState('');
    const [oncePerContact, setOncePerContact] = useState(true);

    /**
     * Non-async on purpose, with the state updates inside .then():
     * React's cascading-render rule treats an awaited setState in a
     * function called straight from an effect as a synchronous one, and
     * this is the shape the dashboard loader already uses.
     */
    const load = useCallback(() => {
        return Promise.all([fetch('/api/loyalty'), fetch('/api/coupons')])
            .then(async ([accountsRes, couponsRes]) => ({
                accounts: accountsRes.ok
                    ? ((await accountsRes.json()).accounts ?? [])
                    : null,
                coupons: couponsRes.ok ? ((await couponsRes.json()).coupons ?? []) : null,
            }))
            .then(({ accounts, coupons }) => {
                if (accounts) setAccounts(accounts);
                if (coupons) setCoupons(coupons);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
                toast.error('Failed to load loyalty data');
            });
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!pointsDialogOpen || contacts.length > 0) return;
        void (async () => {
            const supabase = createClient();
            const { data } = await supabase
                .from('contacts')
                .select('id, name, phone')
                .order('name')
                .limit(500);
            setContacts(data ?? []);
        })();
    }, [pointsDialogOpen, contacts.length]);

    async function adjustPoints(signedPoints: number) {
        if (!contactId || !reason.trim()) {
            toast.error('Contact and reason are required');
            return;
        }
        if (!Number.isInteger(signedPoints) || signedPoints === 0) {
            toast.error('Enter a whole, non-zero number of points');
            return;
        }
        setSaving(true);
        const res = await fetch('/api/loyalty', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: contactId,
                points: signedPoints,
                reason: reason.trim(),
            }),
        });
        setSaving(false);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(data.error ?? 'Failed to record points');
            return;
        }
        toast.success(
            `${signedPoints > 0 ? 'Added' : 'Deducted'} ${Math.abs(signedPoints)} points`,
        );
        setPointsDialogOpen(false);
        setPoints('');
        setReason('');
        void load();
    }

    async function createCoupon() {
        const normalized = normalizeCouponCode(code);
        if (!normalized) {
            toast.error('Enter a coupon code');
            return;
        }
        setSaving(true);
        const res = await fetch('/api/coupons', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: normalized,
                discount_type: discountType,
                discount_value: discountValue,
                expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
                once_per_contact: oncePerContact,
            }),
        });
        setSaving(false);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(data.error ?? 'Failed to create coupon');
            return;
        }
        toast.success(`Coupon ${normalized} created`);
        setCouponDialogOpen(false);
        setCode('');
        void load();
    }

    async function toggleCoupon(coupon: Coupon) {
        const res = await fetch('/api/coupons', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: coupon.id, active: !coupon.active }),
        });
        if (!res.ok) {
            toast.error('Failed to update coupon');
            return;
        }
        void load();
    }

    async function removeCoupon(coupon: Coupon) {
        const res = await fetch(`/api/coupons?id=${coupon.id}`, { method: 'DELETE' });
        if (!res.ok) {
            toast.error('Failed to delete coupon');
            return;
        }
        setCoupons((prev) => prev.filter((c) => c.id !== coupon.id));
    }

    return (
        <div className="space-y-5">
            <ConnectRequiredBanner />
            <div>
                <h1 className="text-2xl font-bold text-foreground">Loyalty & Coupons</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Every points change is written to an audit ledger, so a customer&apos;s
                    balance can always be explained. Tiers follow lifetime points — spending
                    points never demotes anyone.
                </p>
            </div>

            <Tabs defaultValue="members">
                <TabsList className="border border-border bg-background">
                    <TabsTrigger
                        value="members"
                        className="text-muted-foreground data-active:bg-accent data-active:text-primary"
                    >
                        Members
                    </TabsTrigger>
                    <TabsTrigger
                        value="coupons"
                        className="text-muted-foreground data-active:bg-accent data-active:text-primary"
                    >
                        Coupons
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="members" className="space-y-2 pt-3">
                    <div className="flex justify-end">
                        <Button size="sm" onClick={() => setPointsDialogOpen(true)}>
                            <Plus className="size-3.5" />
                            Adjust points
                        </Button>
                    </div>

                    {loading ? (
                        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                            <Loader2 className="size-4 animate-spin" />
                            Loading members…
                        </div>
                    ) : accounts.length === 0 ? (
                        <div className="rounded-xl border border-border bg-background py-16 text-center">
                            <Award className="mx-auto size-8 text-muted-foreground" />
                            <p className="mt-3 text-sm text-foreground">No loyalty members yet</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Award points to a contact and their account opens automatically.
                            </p>
                        </div>
                    ) : (
                        accounts.map((account) => {
                            const tier = tierForPoints(account.lifetime_points);
                            const next = pointsToNextTier(account.lifetime_points);
                            return (
                                <div
                                    key={account.id}
                                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-medium text-foreground">
                                                {account.contact?.name || account.contact?.phone || 'Unknown'}
                                            </span>
                                            <span
                                                className="rounded-full border px-2 py-0.5 text-[10px] font-medium"
                                                style={{ color: tier.color, borderColor: `${tier.color}40` }}
                                            >
                                                {tier.name}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            <span className="font-medium text-foreground">
                                                {account.points_balance.toLocaleString()}
                                            </span>{' '}
                                            points available ·{' '}
                                            {account.lifetime_points.toLocaleString()} lifetime
                                            {next && ` · ${next.needed.toLocaleString()} to ${next.tier.name}`}
                                        </p>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </TabsContent>

                <TabsContent value="coupons" className="space-y-2 pt-3">
                    <div className="flex justify-end">
                        <Button size="sm" onClick={() => setCouponDialogOpen(true)}>
                            <Plus className="size-3.5" />
                            New coupon
                        </Button>
                    </div>

                    {coupons.length === 0 ? (
                        <div className="rounded-xl border border-border bg-background py-16 text-center">
                            <Ticket className="mx-auto size-8 text-muted-foreground" />
                            <p className="mt-3 text-sm text-foreground">No coupons yet</p>
                        </div>
                    ) : (
                        coupons.map((coupon) => {
                            const rejection = couponRejection(coupon);
                            return (
                                <div
                                    key={coupon.id}
                                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background p-4"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
                                                {coupon.code}
                                            </span>
                                            <span className="text-sm text-foreground">
                                                {coupon.discount_type === 'percent'
                                                    ? `${coupon.discount_value}% off`
                                                    : `${formatMoney(coupon.discount_value, coupon.currency)} off`}
                                            </span>
                                            {rejection && (
                                                <span
                                                    className={cn(
                                                        'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                                        'border-amber-500/20 bg-amber-500/10 text-amber-400',
                                                    )}
                                                >
                                                    {rejection.replace('_', ' ')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {coupon.redeemed_count} redeemed
                                            {coupon.max_redemptions
                                                ? ` of ${coupon.max_redemptions}`
                                                : ' · unlimited'}
                                            {coupon.once_per_contact && ' · once per contact'}
                                            {coupon.expires_at &&
                                                ` · expires ${new Date(coupon.expires_at).toLocaleDateString()}`}
                                        </p>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <Switch
                                            checked={coupon.active}
                                            onCheckedChange={() => toggleCoupon(coupon)}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="size-7 p-0 text-muted-foreground hover:text-red-400"
                                            onClick={() => removeCoupon(coupon)}
                                            aria-label={`Delete ${coupon.code}`}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </TabsContent>
            </Tabs>

            {/* Points adjustment */}
            <Dialog open={pointsDialogOpen} onOpenChange={setPointsDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>Adjust points</DialogTitle>
                        <DialogDescription>
                            Both the award and the deduction are recorded in the ledger with the
                            reason you give here.
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
                            <Label className="text-xs text-muted-foreground">Points</Label>
                            <Input
                                value={points}
                                onChange={(e) => setPoints(e.target.value)}
                                inputMode="numeric"
                                placeholder="100"
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Reason</Label>
                            <Input
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="Purchase INV-0012"
                                className="h-8 text-sm"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => adjustPoints(-Math.abs(Number(points)))}
                            disabled={saving}
                        >
                            <Minus className="size-3.5" />
                            Deduct
                        </Button>
                        <Button
                            onClick={() => adjustPoints(Math.abs(Number(points)))}
                            disabled={saving}
                        >
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            <Plus className="size-3.5" />
                            Award
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* New coupon */}
            <Dialog open={couponDialogOpen} onOpenChange={setCouponDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>New coupon</DialogTitle>
                        <DialogDescription>
                            Codes are stored uppercase, so customers typing lowercase still
                            match.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Code</Label>
                            <Input
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                placeholder="DIWALI25"
                                className="h-8 font-mono text-sm"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Type</Label>
                                <select
                                    value={discountType}
                                    onChange={(e) =>
                                        setDiscountType(e.target.value as 'percent' | 'fixed')
                                    }
                                    className="h-8 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground"
                                >
                                    <option value="percent">Percentage</option>
                                    <option value="fixed">Fixed amount</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">
                                    {discountType === 'percent' ? 'Percent off' : 'Amount off'}
                                </Label>
                                <Input
                                    value={discountValue}
                                    onChange={(e) => setDiscountValue(e.target.value)}
                                    inputMode="decimal"
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Expires</Label>
                            <Input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border p-3">
                            <p className="text-sm text-foreground">One use per contact</p>
                            <Switch checked={oncePerContact} onCheckedChange={setOncePerContact} />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setCouponDialogOpen(false)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button onClick={createCoupon} disabled={saving}>
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
