import type { Metadata } from 'next';
import Link from 'next/link';
import {
  MessageSquare,
  Inbox,
  Radio,
  FileText,
  Zap,
  GitBranch,
  BarChart3,
  ShieldCheck,
  Plug,
  Send,
  Check,
  ArrowRight,
} from 'lucide-react';

/**
 * Public marketing landing page. The app previously redirected "/"
 * straight to /dashboard (→ /login when signed out); a real front door
 * matters for new-user signup and for Meta App Review, whose reviewers
 * visit the root domain. Indexable, unlike the app itself.
 */

export const metadata: Metadata = {
  description:
    'Bitlance WhatsApp CRM — team inbox, broadcasts, template builder, and automations for the WhatsApp Business Platform.',
  robots: { index: true, follow: true },
};

const FEATURES = [
  {
    icon: Inbox,
    title: 'Shared team inbox',
    text: 'Every customer conversation in one place. Assign chats, reply with approved templates, and never miss the 24-hour window.',
  },
  {
    icon: Radio,
    title: 'Broadcast campaigns',
    text: 'Send personalized template messages to thousands of contacts, with per-recipient variables and delivery, read, and reply tracking.',
  },
  {
    icon: FileText,
    title: 'Template builder',
    text: 'Design templates with headers, variables, and buttons in a live WhatsApp-style preview — submitted to Meta for approval in one click.',
  },
  {
    icon: Zap,
    title: 'Automations',
    text: 'Keyword replies, welcome flows, tagging, and routing — triggered the moment a message arrives, even while you sleep.',
  },
  {
    icon: GitBranch,
    title: 'Sales pipelines',
    text: 'Track every deal from first message to closed-won with drag-and-drop stages tied to real conversations.',
  },
  {
    icon: BarChart3,
    title: 'Delivery analytics',
    text: 'Sent, delivered, read, replied — live counts per broadcast, powered by WhatsApp status webhooks, not guesswork.',
  },
];

const STEPS = [
  {
    icon: Plug,
    title: 'Connect WhatsApp',
    text: 'Log in with Facebook and follow Meta’s guided setup — no tokens to copy. Your number, templates, and webhooks are wired automatically.',
  },
  {
    icon: FileText,
    title: 'Import your audience',
    text: 'Upload contacts via CSV, tag them into segments, and sync your approved message templates from Meta.',
  },
  {
    icon: Send,
    title: 'Start conversations',
    text: 'Launch your first broadcast, watch replies land in the shared inbox, and let automations handle the routine.',
  },
];

export default function LandingPage() {
  return (
    <div className="bg-background text-foreground">
      {/* ── Nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
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
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Pricing
            </Link>
            <Link
              href="/compare"
              className="hidden rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Compare
            </Link>
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

      <main>
        {/* ── Hero ──────────────────────────────────────────── */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Built on the WhatsApp Business Platform
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Turn WhatsApp into your
              <br />
              revenue channel.
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
              A CRM built for WhatsApp-first businesses — shared inbox,
              broadcast campaigns, an approval-ready template builder, and
              automations that reply while you sleep.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-accent"
              >
                Sign in
              </Link>
            </div>
            <ul className="mt-8 space-y-2 text-sm text-muted-foreground">
              {[
                'Connect in minutes with Facebook login',
                'Official Meta Cloud API — no phone tethering',
                'Your data, isolated per account, encrypted at rest',
              ].map((line) => (
                <li key={line} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Chat mockup */}
          <div className="relative mx-auto w-full max-w-sm">
            <div className="rounded-2xl border border-border bg-[#0b141a] p-4 shadow-xl">
              <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                  B
                </div>
                <div>
                  <p className="text-sm font-medium text-white">Bitlance Store</p>
                  <p className="text-[11px] text-emerald-400">online</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="max-w-[85%] rounded-lg rounded-tl-none bg-[#202c33] p-2.5 text-[13px] text-[#e9edef]">
                  Hi! Is the blue variant back in stock?
                  <span className="mt-1 block text-right text-[10px] text-[#8696a0]">
                    10:02
                  </span>
                </div>
                <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#005c4b] p-2.5 text-[13px] text-[#e9edef]">
                  Hi Priya! Yes — back in stock today. Want me to reserve one
                  for you?
                  <span className="mt-1 block text-right text-[10px] text-[#8696a0]">
                    10:02 ✓✓
                  </span>
                </div>
                <div className="max-w-[85%] rounded-lg rounded-tl-none bg-[#202c33] p-2.5 text-[13px] text-[#e9edef]">
                  Yes please! 🎉
                  <span className="mt-1 block text-right text-[10px] text-[#8696a0]">
                    10:03
                  </span>
                </div>
                <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#005c4b] p-2.5 text-[13px] text-[#e9edef]">
                  Done — order <b>#1042</b> reserved. Pay on delivery or UPI?
                  <span className="mt-1 block text-right text-[10px] text-[#8696a0]">
                    10:03 ✓✓
                  </span>
                </div>
              </div>
              <p className="mt-3 border-t border-white/10 pt-2 text-center text-[10px] text-[#8696a0]">
                Sent by automation · assigned to Rahul
              </p>
            </div>
          </div>
        </section>

        {/* ── Features ──────────────────────────────────────── */}
        <section className="border-t border-border bg-accent/30">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
              Everything a WhatsApp-first team needs
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
              One workspace for the whole customer journey — from the first
              broadcast to the closed deal.
            </p>
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="rounded-xl border border-border bg-background p-6"
                >
                  <f.icon className="h-5 w-5 text-primary" />
                  <h3 className="mt-4 text-sm font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {f.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── How it works ──────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Live in an afternoon
          </h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <div key={s.title} className="relative">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {i + 1}
                  </div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {s.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Trust strip ───────────────────────────────────── */}
        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-6 py-10 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Tokens encrypted with AES-256-GCM
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Signed webhooks, verified on every event
            </span>
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Per-account data isolation
            </span>
          </div>
        </section>

        {/* ── CTA ───────────────────────────────────────────── */}
        <section className="border-t border-border bg-accent/30">
          <div className="mx-auto max-w-6xl px-6 py-20 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your customers are already on WhatsApp.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
              Connect your WhatsApp Business account and send your first
              broadcast today.
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Create your account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────── */}
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
            <a
              href="mailto:ceo@bitlancetechhub.com"
              className="hover:text-foreground"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
