'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { BadgeCheck, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

/**
 * WACRM plan purchase / status card (Settings → Billing, top). Loads
 * Razorpay Checkout on demand; activation happens server-side only
 * after signature verification.
 */

interface Plan {
 slug: string;
 name: string;
 description: string | null;
 price_monthly_minor: number;
 price_yearly_minor: number | null;
 currency: string;
 max_seats: number | null;
 highlight: boolean;
}

interface Subscription {
 plan_slug: string;
 interval: 'monthly' | 'yearly';
 status: string;
 current_period_end: string;
}

declare global {
 interface Window {
 Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
 }
}

function loadCheckoutScript(): Promise<void> {
 return new Promise((resolve, reject) => {
 if (window.Razorpay) return resolve();
 const s = document.createElement('script');
 s.src = 'https://checkout.razorpay.com/v1/checkout.js';
 s.onload = () => resolve();
 s.onerror = () => reject(new Error('Failed to load Razorpay'));
 document.body.appendChild(s);
 });
}

function formatPrice(minor: number, currency: string): string {
 return new Intl.NumberFormat('en-IN', {
 style: 'currency',
 currency,
 maximumFractionDigits: 0,
 }).format(minor / 100);
}

export function PlanSubscriptionCard() {
 const [loading, setLoading] = useState(true);
 const [plans, setPlans] = useState<Plan[]>([]);
 const [subscription, setSubscription] = useState<Subscription | null>(null);
 const [isOwner, setIsOwner] = useState(true);
 const [configured, setConfigured] = useState(true);
 const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
 const [paying, setPaying] = useState<string | null>(null);

 function refresh() {
 return fetch('/api/billing/subscription')
 .then((r) => r.json())
 .then((data) => {
 setPlans(data.plans ?? []);
 setSubscription(data.subscription ?? null);
 setIsOwner(data.is_owner ?? true);
 setConfigured(data.configured ?? false);
 })
 .catch(() => toast.error('Failed to load plans'));
 }

 useEffect(() => {
 refresh().finally(() => setLoading(false));
 }, []);

 async function handleSubscribe(plan: Plan) {
 setPaying(plan.slug);
 try {
 const res = await fetch('/api/billing/checkout', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify({ plan_slug: plan.slug, interval }),
 });
 const data = await res.json();
 if (!res.ok) throw new Error(data.error || 'Checkout failed');

 await loadCheckoutScript();
 if (!window.Razorpay) throw new Error('Razorpay unavailable');

 const rzp = new window.Razorpay({
 key: data.key_id,
 order_id: data.order_id,
 amount: data.amount,
 currency: data.currency,
 name: 'WACRM',
 description: `${data.plan_name} plan — ${interval}`,
 prefill: { email: data.email ?? '' },
 theme: { color: '#22c55e' },
 handler: async (resp: {
 razorpay_order_id: string;
 razorpay_payment_id: string;
 razorpay_signature: string;
 }) => {
 try {
 const vr = await fetch('/api/billing/checkout/verify', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(resp),
 });
 const vd = await vr.json();
 if (!vr.ok) throw new Error(vd.error || 'Verification failed');
 toast.success(`You're on the ${data.plan_name} plan 🎉`);
 await refresh();
 } catch (err) {
 toast.error(
 err instanceof Error ? err.message : 'Verification failed',
 );
 }
 },
 modal: { ondismiss: () => setPaying(null) },
 });
 rzp.open();
 } catch (err) {
 toast.error(err instanceof Error ? err.message : 'Checkout failed');
 } finally {
 setPaying(null);
 }
 }

 if (loading) {
 return (
 <Card className="border-border bg-background">
 <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
 <Loader2 className="size-4 animate-spin" />
 Loading plan…
 </CardContent>
 </Card>
 );
 }

 const activePlan =
 subscription &&
 subscription.status === 'active' &&
 new Date(subscription.current_period_end).getTime() > Date.now()
 ? plans.find((p) => p.slug === subscription.plan_slug)
 : null;

 return (
 <Card className="border-border bg-background">
 <CardContent className="space-y-4 pt-6">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div>
 <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
 <Sparkles className="size-4 text-primary" />
 Your WACRM plan
 </h3>
 <p className="mt-1 text-xs text-muted-foreground">
 {activePlan ? (
 <>
 <span className="font-medium text-foreground">
 {activePlan.name}
 </span>{' '}
 ({subscription!.interval}) — renews{' '}
 {new Date(
 subscription!.current_period_end,
 ).toLocaleDateString('en-IN', {
 day: 'numeric',
 month: 'short',
 year: 'numeric',
 })}
 </>
 ) : (
 'No active subscription — pick a plan below.'
 )}
 </p>
 </div>
 {activePlan && (
 <Badge className="border border-primary/30 bg-primary/20 text-xs text-primary">
 <BadgeCheck className="size-3.5" /> Active
 </Badge>
 )}
 </div>

 {!isOwner ? (
 <p className="text-xs text-muted-foreground">
 The workspace owner manages the subscription.
 </p>
 ) : !configured ? (
 <p className="text-xs text-muted-foreground">
 Online payment isn&apos;t enabled on this deployment yet.
 </p>
 ) : (
 <>
 <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
 {(['monthly', 'yearly'] as const).map((iv) => (
 <button
 key={iv}
 type="button"
 onClick={() => setInterval(iv)}
 className={`rounded px-2.5 py-1 capitalize transition-colors ${
 interval === iv
 ? 'bg-primary text-primary-foreground'
 : 'text-muted-foreground hover:text-foreground'
 }`}
 >
 {iv}
 {iv === 'yearly' && ' (2 months free)'}
 </button>
 ))}
 </div>

 <div className="grid gap-3 sm:grid-cols-3">
 {plans.map((plan) => {
 const price =
 interval === 'yearly'
 ? plan.price_yearly_minor
 : plan.price_monthly_minor;
 const isCurrent = activePlan?.slug === plan.slug;
 return (
 <div
 key={plan.slug}
 className={`rounded-lg border p-3 ${
 plan.highlight ? 'border-primary/50' : 'border-border'
 }`}
 >
 <div className="flex items-center justify-between gap-1">
 <p className="text-sm font-medium text-foreground">
 {plan.name}
 </p>
 {plan.highlight && (
 <Badge className="border border-primary/30 bg-primary/10 text-[10px] text-primary">
 Popular
 </Badge>
 )}
 </div>
 <p className="mt-1 text-lg font-semibold text-foreground">
 {price ? formatPrice(price, plan.currency) : '—'}
 <span className="text-xs font-normal text-muted-foreground">
 /{interval === 'yearly' ? 'yr' : 'mo'}
 </span>
 </p>
 <p className="mt-0.5 text-[11px] text-muted-foreground">
 {plan.max_seats == null
 ? 'Unlimited team members'
 : `${plan.max_seats} team member${plan.max_seats === 1 ? '' : 's'}`}
 </p>
 <Button
 size="sm"
 disabled={!price || isCurrent || paying !== null}
 onClick={() => handleSubscribe(plan)}
 className="mt-2 w-full"
 variant={plan.highlight ? 'default' : 'outline'}
 >
 {paying === plan.slug && (
 <Loader2 className="size-3.5 animate-spin" />
 )}
 {isCurrent
 ? 'Current plan'
 : activePlan
 ? 'Switch'
 : 'Subscribe'}
 </Button>
 </div>
 );
 })}
 </div>
 <p className="text-[11px] text-muted-foreground">
 Payments are processed by Razorpay. Your card/UPI details never
 touch our servers.
 </p>
 </>
 )}
 </CardContent>
 </Card>
 );
}
