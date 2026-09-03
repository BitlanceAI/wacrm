import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, Minus, MessageSquare, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Compare',
  description:
    'How Bitlance WhatsApp CRM compares with WATI, AiSensy, Interakt and other WhatsApp Business platforms on pricing and features.',
  robots: { index: true, follow: true },
};

/**
 * Competitor figures are their publicly listed India prices as of
 * September 2026 (entry-tier monthly). Update alongside any pricing
 * refresh — stale competitor numbers age worse than none.
 */
const COMPETITORS = [
  { name: 'Bitlance CRM', price: '₹999', markup: false, us: true },
  { name: 'Interakt', price: '₹999', markup: false, us: false },
  { name: 'AiSensy', price: '₹1,500', markup: false, us: false },
  { name: 'WATI', price: '₹2,199', markup: false, us: false },
  { name: 'Zoko', price: '~₹4,200', markup: true, us: false },
  { name: 'Gallabox', price: '~₹7,500', markup: true, us: false },
];

const FEATURES: { label: string; have: boolean[] }[] = [
  //                        us     Interakt AiSensy WATI  Zoko  Gallabox
  { label: 'Shared team inbox', have: [true, true, true, true, true, true] },
  { label: 'Broadcast campaigns', have: [true, true, true, true, true, true] },
  { label: 'In-app template builder (submits to Meta)', have: [true, true, true, true, true, true] },
  { label: 'Chatbot flows', have: [true, true, true, true, true, true] },
  { label: 'Automations & keyword replies', have: [true, true, true, true, true, true] },
  { label: 'Sales pipelines / CRM', have: [true, false, false, false, false, true] },
  { label: 'Catalog & order management', have: [true, false, false, true, true, true] },
  { label: 'Invoices & payment reminders', have: [true, false, false, false, false, false] },
  { label: 'Loyalty points & coupons', have: [true, false, false, false, false, false] },
  { label: 'Appointment bookings', have: [true, false, false, false, false, false] },
  { label: 'Developer API & webhooks', have: [true, true, true, true, true, true] },
  { label: 'WhatsApp Business App coexistence', have: [true, false, true, true, false, false] },
  { label: 'Zero markup on Meta message rates', have: [true, true, true, true, false, false] },
];

export default function ComparePage() {
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
              href="/pricing"
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
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
            How we compare
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            The full commerce stack — inbox to invoices to loyalty — at an
            entry price the incumbents charge for messaging alone.
          </p>
        </div>

        <div className="mt-12 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-64 p-3 text-left font-medium text-muted-foreground">
                  &nbsp;
                </th>
                {COMPETITORS.map((c) => (
                  <th
                    key={c.name}
                    className={
                      c.us
                        ? 'rounded-t-xl bg-primary/5 p-3 text-center'
                        : 'p-3 text-center'
                    }
                  >
                    <p className="font-semibold text-foreground">{c.name}</p>
                    <p className="mt-1 text-xs font-normal text-muted-foreground">
                      from {c.price}/mo
                    </p>
                    {c.markup && (
                      <p className="mt-0.5 text-[10px] font-normal text-amber-500">
                        + per-message markup
                      </p>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <td className="p-3 text-muted-foreground">{row.label}</td>
                  {row.have.map((has, i) => (
                    <td
                      key={i}
                      className={
                        COMPETITORS[i].us
                          ? 'bg-primary/5 p-3 text-center'
                          : 'p-3 text-center'
                      }
                    >
                      {has ? (
                        <Check className="mx-auto h-4 w-4 text-emerald-500" />
                      ) : (
                        <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Competitor pricing and features from their public websites and plan
          pages as of September 2026; entry-tier monthly prices shown.
          Trademarks belong to their respective owners.
        </p>

        <div className="mt-14 text-center">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Start free
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <p>© {new Date().getFullYear()} Bitlance Tech Hub</p>
          <nav className="flex items-center gap-6">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
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
