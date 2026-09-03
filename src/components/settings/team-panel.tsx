'use client';

/**
 * Team management (Settings → Team). Owners invite members who log in
 * with their own credentials and work inside the owner's tenant
 * (Path-B multi-user — see migration 024). Members see a read-only
 * notice instead of the management UI.
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { useTenant } from '@/hooks/use-tenant';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface Member {
  id: string;
  member_user_id: string;
  role: string;
  status: string;
  invited_email: string | null;
  created_at: string;
  display_name: string;
}

export function TeamPanel() {
  const { isTeamMember, loading: tenantLoading } = useTenant();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'agent' | 'admin'>('agent');
  // Credentials of a freshly invited member — shown once.
  const [freshInvite, setFreshInvite] = useState<{ email: string; password: string } | null>(null);

  useEffect(() => {
    if (tenantLoading || isTeamMember) {
      setLoading(false);
      return;
    }
    fetch('/api/team')
      .then((r) => r.json())
      .then((data) => setMembers(data.members ?? []))
      .catch(() => toast.error('Failed to load team'))
      .finally(() => setLoading(false));
  }, [tenantLoading, isTeamMember]);

  async function handleInvite() {
    setInviting(true);
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), full_name: fullName.trim(), role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setFreshInvite({ email: data.email, password: data.password });
      setMembers((m) => [
        ...m,
        {
          id: crypto.randomUUID(), // replaced on next load; only a list key
          member_user_id: data.member_user_id,
          role,
          status: 'active',
          invited_email: data.email,
          created_at: new Date().toISOString(),
          display_name: fullName.trim() || data.email,
        },
      ]);
      setInviteOpen(false);
      setEmail(''); setFullName(''); setRole('agent');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invite failed');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(m: Member) {
    if (!confirm(`Remove ${m.display_name} from the team? Their login will be deleted.`)) return;
    setRemoving(m.id);
    try {
      const res = await fetch(`/api/team?id=${m.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove member');
      setMembers((list) => list.filter((x) => x.id !== m.id));
      toast.success('Member removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setRemoving(null);
    }
  }

  if (tenantLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isTeamMember) {
    return (
      <Card className="mt-4 bg-background border-border ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Users className="size-4" /> Team
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            You&apos;re a member of this workspace. The workspace owner manages
            the team, WhatsApp connection, and billing.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <Card className="bg-background border-border ring-0 ring-transparent">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-foreground">
                <Users className="size-4" /> Team Members
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Members log in with their own credentials and share this
                workspace&apos;s inbox, contacts, and campaigns.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <Plus className="size-3.5" /> Invite member
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No team members yet — it&apos;s just you.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{m.display_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {m.invited_email} · <span className="capitalize">{m.role}</span>
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handleRemove(m)}
                    disabled={removing === m.id}
                    className="h-8 shrink-0 border-border px-2 text-xs text-red-400"
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="border-border bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Invite a team member</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              An account is created for them; you&apos;ll get a one-time
              password to share. Use an email that doesn&apos;t already have an
              account here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-foreground">Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Priya Sharma" className="border-border bg-accent text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground">Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="priya@company.com" className="border-border bg-accent text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground">Role</Label>
              <Select value={role} onValueChange={(v) => v && setRole(v as 'agent' | 'admin')}>
                <SelectTrigger className="w-full bg-accent border-border text-foreground"><SelectValue /></SelectTrigger>
                <SelectContent className="bg-background border-border">
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setInviteOpen(false)} className="border-border text-foreground">Cancel</Button>
            <Button onClick={handleInvite} disabled={inviting || !email.trim()} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {inviting && <Loader2 className="size-4 animate-spin" />} Invite
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-time credentials reveal */}
      <Dialog open={!!freshInvite} onOpenChange={(o) => !o && setFreshInvite(null)}>
        <DialogContent className="border-border bg-background sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Share these credentials now</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              The password is shown only once. Ask them to change it after
              first login (Settings → Profile).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input readOnly value={freshInvite?.email ?? ''} className="border-border bg-accent text-sm text-foreground" />
            <div className="flex items-center gap-2">
              <Input readOnly value={freshInvite?.password ?? ''} className="border-border bg-accent font-mono text-sm text-foreground" />
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(`${freshInvite?.email}\n${freshInvite?.password}`);
                  toast.success('Credentials copied');
                }}
                className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Copy className="size-4" /> Copy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
