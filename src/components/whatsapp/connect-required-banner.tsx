'use client';

/**
 * "Connect WhatsApp first" banner for feature tabs that are useless
 * (or misleading) without a connected WhatsApp Business account —
 * inbox, broadcasts, templates, catalog, invoices, appointments,
 * loyalty.
 *
 * Renders nothing while the status is loading or when connected, so
 * pages can mount it unconditionally at the top. The check reads the
 * stored config row's status (cheap, RLS-scoped) rather than the
 * Meta-pinging health endpoint — gating a tab doesn't need a live
 * Meta round-trip on every navigation.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquareWarning, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

export function ConnectRequiredBanner() {
  const { user, loading: authLoading } = useAuth();
  // null = still checking; render nothing until we know.
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    createClient()
      .from('whatsapp_config')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setConnected(data?.status === 'connected');
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (connected !== false) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
      <div className="flex items-center gap-3">
        <MessageSquareWarning className="size-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Connect your WhatsApp account first
          </p>
          <p className="text-xs text-muted-foreground">
            This feature needs a connected WhatsApp Business account to work.
          </p>
        </div>
      </div>
      <Link
        href="/settings?tab=whatsapp"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Connect WhatsApp
        <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
