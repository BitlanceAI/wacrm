'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

/**
 * Which tenant does the signed-in person work in?
 *
 * Owners: their own user id (the historical behavior — nothing changes
 * for existing accounts). Team members: the OWNER's user id, so every
 * tenant-keyed query and insert (`.eq('user_id', tenantId)`,
 * `{ user_id: tenantId }`) lands in the shared workspace.
 *
 * `tenantId` is null while resolving — callers already waiting on
 * `useAuth().loading` should also wait for `tenantLoading` before
 * firing tenant-keyed queries.
 */
export function useTenant() {
  const { user, loading: authLoading } = useAuth();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [isTeamMember, setIsTeamMember] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setTenantId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    createClient()
      .from('team_members')
      .select('owner_user_id')
      .eq('member_user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setTenantId((data?.owner_user_id as string | undefined) ?? user.id);
        setIsTeamMember(Boolean(data?.owner_user_id));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return { tenantId, isTeamMember, loading };
}
