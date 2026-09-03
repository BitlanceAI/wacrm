import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, MessageSquare, ArrowRight } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Simple monthly plans for Bitlance WhatsApp CRM — Meta message rates passed through at cost, zero markup.',
  robots: { index: true, follow: true },
};

// Plans change from the admin panel; re-render at most every 5 minutes
// rather than on every request.
export const revalidate = 300;

interface Plan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price_monthly_minor: number;
  price_yearly_minor: number | null;
  features: string[];
  highlight: boolean;
  sort_order: number;
}

const fmt = new Intl.NumberFormat('en-IN');

async function loadPlans(): Promise<Plan[]> {
  // Anonymous read — RLS exposes active plans to everyone, and using
  // the bare anon client keeps this page cacheable (no cookies).
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true });
  return (data as Plan[]) ?? [];
}

export default async function PricingPage() {
  const plans = await loadPlans();

  return (
    <div className="bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            <span className="text-sm font-semibold tracking-tight">
              Bitlance WhatsApp CRM
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight">
            Simple pricing. No message markup.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            One flat monthly fee for the platform. WhatsApp messages are billed
            by Meta directly to your account at Meta&apos;s own rates — we add
            nothing on top.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={
                plan.highlight
                  ? 'relative rounded-2xl border-2 border-primary bg-background p-7'
                  : 'rounded-2xl border border-border bg-background p-7'
              }
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  MOST POPULAR
                </span>
              )}
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              {plan.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {plan.description}
                </p>
              )}
              <p className="mt-5">
                <span className="text-4xl font-bold tabular-nums">
                  ₹{fmt.format(plan.price_monthly_minor / 100)}
                </span>
                <span className="text-sm text-muted-foreground"> /month</span>
              </p>
              {plan.price_yearly_minor != null && (
                <p className="mt-1 text-xs text-muted-foreground">
                  or ₹{fmt.format(plan.price_yearly_minor / 100)}/year
                </p>
              )}
              <Link
                href="/signup"
                className={
                  plan.highlight
                    ? 'mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90'
                    : 'mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent'
                }
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <ul className="mt-6 space-y-2.5">
                {(plan.features ?? []).map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {plans.length === 0 && (
            <p className="col-span-3 text-center text-sm text-muted-foreground">
              Plans are being updated — check back shortly, or{' '}
              <a className="underline" href="mailto:ceo@bitlancetechhub.com">
                contact us
              </a>
              .
            </p>
          )}
        </div>

        {/* Meta pass-through explainer */}
        <div className="mx-auto mt-14 max-w-3xl rounded-2xl border border-border bg-accent/30 p-6">
          <h3 className="text-sm font-semibold">
            What about WhatsApp message costs?
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Meta charges for template messages per delivery, billed directly to
            your WhatsApp Business Account — in India currently ≈ ₹0.86 per
            marketing template and ≈ ₹0.12 per utility template, with replies
            inside the 24-hour service window free up to Meta&apos;s monthly
            allowance. Unlike platforms that add 10–20% on top of every
            message, we pass Meta&apos;s rates through untouched: you connect
            your own account, Meta bills you at cost, and our fee never scales
            against your sending.
          </p>
          <p className="mt-3 text-sm">
            <Link href="/compare" className="text-primary hover:underline">
              See how we compare to other platforms →
            </Link>
          </p>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Bitlance Tech Hub</p>
          <nav className="flex items-center gap-6">
            <Link href="/compare" className="hover:text-foreground">
              Compare
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
