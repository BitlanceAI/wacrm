'use client';

/**
 * Developers panel — self-serve chatbot/integration setup:
 *  - API keys for the public /api/v1/* endpoints (shown once, hashed
 *    at rest, revocable)
 *  - one outbound webhook per account: inbound WhatsApp messages are
 *    relayed there as HMAC-signed `message.received` events
 *  - inline quick-start docs, since this panel IS the developer docs
 *    for v1
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2, Plus, RefreshCw, Trash2, Webhook } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface WebhookRow {
  url: string;
  secret: string;
  active: boolean;
  last_delivery_at: string | null;
  last_error: string | null;
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Copy failed'),
  );
}

export function DeveloperPanel() {
  const supabase = createClient();
  const { user } = useAuth();

  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [webhook, setWebhook] = useState<WebhookRow | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  // Plaintext of a freshly created key — exists only until the dialog closes.
  const [freshKey, setFreshKey] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: keyRows }, webhookRes] = await Promise.all([
        supabase
          .from('api_keys')
          .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
          .order('created_at', { ascending: false }),
        fetch('/api/developer/webhook').then((r) => r.json()).catch(() => ({ webhook: null })),
      ]);
      setKeys(keyRows ?? []);
      if (webhookRes.webhook) {
        setWebhook(webhookRes.webhook);
        setWebhookUrl(webhookRes.webhook.url);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function createKey() {
    setCreating(true);
    try {
      const res = await fetch('/api/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() || 'API key' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create key');
      setFreshKey(data.key);
      setKeys((k) => [
        { id: data.id, name: data.name, key_prefix: data.key_prefix, created_at: data.created_at, last_used_at: null, revoked_at: null },
        ...k,
      ]);
      setNewKeyName('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create key');
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    const res = await fetch(`/api/developer/keys?id=${id}`, { method: 'DELETE' });
    if (!res.ok) return toast.error('Failed to revoke key');
    setKeys((k) => k.map((row) => (row.id === id ? { ...row, revoked_at: new Date().toISOString() } : row)));
    toast.success('Key revoked');
  }

  async function saveWebhook(patch: { url?: string; active?: boolean; rotate_secret?: boolean }) {
    setSavingWebhook(true);
    try {
      const res = await fetch('/api/developer/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save webhook');
      setWebhook(data.webhook);
      setWebhookUrl(data.webhook.url);
      toast.success(patch.rotate_secret ? 'Secret rotated' : 'Webhook saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save webhook');
    } finally {
      setSavingWebhook(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const activeKeys = keys.filter((k) => !k.revoked_at);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="mt-4 space-y-6">
      {/* ── API keys ─────────────────────────────────────────── */}
      <Card className="bg-background border-border ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <KeyRound className="size-4" /> API Keys
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Authenticate requests to the v1 API with{' '}
            <code className="text-xs">Authorization: Bearer wak_live_…</code>.
            Keys are shown once and stored hashed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key name, e.g. Support bot"
              className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
            />
            <Button
              onClick={createKey}
              disabled={creating}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Create key
            </Button>
          </div>

          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No keys yet.</p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">
                      {k.name}{' '}
                      <span className="font-mono text-xs text-muted-foreground">{k.key_prefix}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {k.revoked_at
                        ? 'Revoked'
                        : k.last_used_at
                          ? `Last used ${new Date(k.last_used_at).toLocaleString()}`
                          : 'Never used'}
                    </p>
                  </div>
                  {!k.revoked_at && (
                    <Button
                      variant="outline"
                      onClick={() => revokeKey(k.id)}
                      className="h-8 shrink-0 border-border px-2 text-xs text-red-400"
                    >
                      <Trash2 className="size-3.5" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Outbound webhook ─────────────────────────────────── */}
      <Card className="bg-background border-border ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Webhook className="size-4" /> Inbound Message Webhook
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Every incoming WhatsApp message is POSTed to this URL as a{' '}
            <code className="text-xs">message.received</code> event, signed with{' '}
            <code className="text-xs">X-Wacrm-Signature</code> (HMAC-SHA256 of the raw body).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-bot.example.com/wacrm-webhook"
              className="border-border bg-accent text-foreground placeholder:text-muted-foreground"
            />
            <Button
              onClick={() => saveWebhook({ url: webhookUrl.trim() })}
              disabled={savingWebhook || !webhookUrl.trim()}
              className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {savingWebhook && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </div>

          {webhook && (
            <>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-foreground">Enabled</Label>
                <Switch
                  checked={webhook.active}
                  onCheckedChange={(v) => saveWebhook({ active: v })}
                />
                <span className="ml-auto text-xs text-muted-foreground">
                  {webhook.last_error
                    ? `Last delivery failed: ${webhook.last_error}`
                    : webhook.last_delivery_at
                      ? `Last delivered ${new Date(webhook.last_delivery_at).toLocaleString()}`
                      : 'No deliveries yet'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={webhook.secret}
                  className="border-border bg-accent font-mono text-xs text-foreground"
                />
                <Button variant="outline" onClick={() => copy(webhook.secret, 'Signing secret')} className="h-9 shrink-0 border-border px-2 text-xs text-foreground">
                  <Copy className="size-3.5" />
                </Button>
                <Button variant="outline" onClick={() => saveWebhook({ rotate_secret: true })} className="h-9 shrink-0 border-border px-2 text-xs text-foreground" title="Rotate the signing secret (invalidates the current one immediately)">
                  <RefreshCw className="size-3.5" /> Rotate
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Quick start ──────────────────────────────────────── */}
      <Card className="bg-background border-border ring-0 ring-transparent">
        <CardHeader>
          <CardTitle className="text-foreground">Quick Start</CardTitle>
          <CardDescription className="text-muted-foreground">
            A chatbot is two pieces: receive events at your webhook, reply via the API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-lg border border-border bg-accent p-4 text-xs leading-5 text-foreground">
{`# Send a text message (inside the 24h service window)
curl -X POST ${origin}/api/v1/messages \\
  -H "Authorization: Bearer wak_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","type":"text","text":"Hello from my bot!"}'

# Send an approved template (any time)
curl -X POST ${origin}/api/v1/messages \\
  -H "Authorization: Bearer wak_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"to":"919876543210","type":"template",
       "template_name":"order_update","language":"en_US",
       "params":["John","#1042"]}'

# List approved templates          GET ${origin}/api/v1/templates
# Look up / create a contact      GET|POST ${origin}/api/v1/contacts

# Verifying webhook deliveries (Node):
#   expected = "sha256=" + crypto.createHmac("sha256", SECRET)
#                               .update(rawBody).digest("hex")
#   compare with the X-Wacrm-Signature header`}
          </pre>
        </CardContent>
      </Card>

      {/* One-time key reveal */}
      <Dialog open={!!freshKey} onOpenChange={(open) => !open && setFreshKey(null)}>
        <DialogContent className="border-border bg-background sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">Copy your API key now</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This is the only time it will be shown — we store only a hash.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={freshKey ?? ''} className="border-border bg-accent font-mono text-xs text-foreground" />
            <Button onClick={() => freshKey && copy(freshKey, 'API key')} className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
              <Copy className="size-4" /> Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {activeKeys.length}/10 active keys in use.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
