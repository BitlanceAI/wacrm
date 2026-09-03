'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { maybeSyncTemplates } from '@/lib/whatsapp/template-sync';
import { TemplateBuilder } from '@/components/settings/template-builder';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { MessageTemplate } from '@/types';

const categoryColors: Record<string, string> = {
 Marketing: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
 Utility: 'bg-blue-600/20 text-blue-400 border-blue-600/30',
 Authentication: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
};

const statusColors: Record<string, string> = {
 Draft: 'bg-slate-600/20 text-muted-foreground border-border',
 Pending: 'bg-yellow-600/20 text-yellow-400 border-yellow-600/30',
 Approved: 'bg-primary/20 text-primary border-primary/30',
 Rejected: 'bg-red-600/20 text-red-400 border-red-600/30',
};

export function TemplateManager() {
 const supabase = createClient();
 const { user, loading: authLoading } = useAuth();

 const [loading, setLoading] = useState(true);
 const [templates, setTemplates] = useState<MessageTemplate[]>([]);
 const [dialogOpen, setDialogOpen] = useState(false);
 const [syncing, setSyncing] = useState(false);
 // WABA id of the connected account — powers the "Manage on Meta"
 // deep link into WhatsApp Manager's template editor. Null until
 // loaded (or when no WABA is configured), which hides the button.
 const [wabaId, setWabaId] = useState<string | null>(null);

 useEffect(() => {
 if (authLoading) return;
 if (!user) {
 setLoading(false);
 return;
 }
 fetchTemplates(user.id);
 // Best-effort: resolve the WABA id for the Meta deep link.
 supabase
 .from('whatsapp_config')
 .select('waba_id')
 .maybeSingle()
 .then(({ data }) => setWabaId(data?.waba_id ?? null));
 // Background: if the cached copy is stale, pull fresh templates from
 // Meta and refetch so newly-approved templates appear on their own.
 maybeSyncTemplates(user.id).then((changed) => {
 if (changed) fetchTemplates(user.id);
 });
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [authLoading, user?.id]);

 async function fetchTemplates(userId: string) {
 try {
 setLoading(true);

 const { data, error } = await supabase
 .from('message_templates')
 .select('*')
 .order('created_at', { ascending: false });

 if (error) throw error;
 setTemplates(data || []);
 } catch (err) {
 console.error('Failed to fetch templates:', err);
 toast.error('Failed to load templates');
 } finally {
 setLoading(false);
 }
 }

 /**
 * Pull approved templates from Meta and upsert them into the local
 * catalog. After this runs, every local row is guaranteed to match
 * something Meta will actually accept on send — stops users getting
 * stuck on error #132001 "Template name does not exist".
 */
 async function handleSyncFromMeta() {
 if (!user) return;
 setSyncing(true);
 try {
 const res = await fetch('/api/whatsapp/templates/sync', {
 method: 'POST',
 });
 const data = await res.json();
 if (!res.ok) {
 throw new Error(data?.error || `Sync failed (HTTP ${res.status})`);
 }
 const detail = [
 data.inserted ? `${data.inserted} new` : null,
 data.updated ? `${data.updated} updated` : null,
 // Called out explicitly: removals are usually the previous
 // WhatsApp account's templates disappearing after a config
 // change, and a silent drop looks like data loss.
 data.removed ? `${data.removed} removed` : null,
 ].filter(Boolean);
 toast.success(
 `Synced ${data.total} template${data.total === 1 ? '' : 's'} from Meta` +
 (detail.length ? ` (${detail.join(', ')})` : ''),
 );
 if (Array.isArray(data.errors) && data.errors.length > 0) {
 // Surface per-template failures so users don't trust a green
 // toast that hides silent drift.
 const preview = data.errors.slice(0, 3).map(
 (e: { name: string; language: string; message: string }) =>
 `${e.name} (${e.language})`,
 );
 const suffix =
 data.errors.length > 3 ? `, +${data.errors.length - 3} more` : '';
 toast.error(`Failed to sync: ${preview.join(', ')}${suffix}`);
 }
 if (data.truncated) {
 toast.warning(
 'Hit Meta pagination cap — more templates may exist. Contact support if this persists.',
 );
 }
 await fetchTemplates(user.id);
 } catch (err) {
 console.error('Template sync error:', err);
 toast.error(
 err instanceof Error ? err.message : 'Failed to sync templates',
 );
 } finally {
 setSyncing(false);
 }
 }

 async function handleDelete(id: string) {
 try {
 const { error } = await supabase
 .from('message_templates')
 .delete()
 .eq('id', id);

 if (error) throw error;
 toast.success('Template deleted');
 setTemplates((prev) => prev.filter((t) => t.id !== id));
 } catch (err) {
 console.error('Delete error:', err);
 toast.error('Failed to delete template');
 }
 }

 if (loading) {
 return (
 <div className="flex items-center justify-center py-12">
 <Loader2 className="size-6 animate-spin text-primary" />
 </div>
 );
 }

 return (
 <div className="space-y-4 mt-4">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <div>
 <h2 className="text-lg font-semibold text-foreground">Message Templates</h2>
 <p className="text-sm text-muted-foreground">
 Create and manage your WhatsApp message templates. Meta requires
 every template to be approved in the WhatsApp Manager before it can
 be sent — use &quot;Sync from Meta&quot; to pull your approved list.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <Button
 variant="outline"
 onClick={handleSyncFromMeta}
 disabled={syncing}
 className="border-border bg-transparent text-foreground hover:bg-accent"
 title="Pull approved templates from your Meta WhatsApp Business Account"
 >
 <RefreshCw
 className={`size-4 ${syncing ? 'animate-spin' : ''}`}
 />
 {syncing ? 'Syncing…' : 'Sync from Meta'}
 </Button>
 <Button
 onClick={() => setDialogOpen(true)}
 className="bg-primary hover:bg-primary/90 text-primary-foreground"
 >
 <Plus className="size-4" />
 New Template
 </Button>
 {wabaId && (
 <Button
 variant="outline"
 onClick={() =>
 window.open(
 `https://business.facebook.com/wa/manage/message-templates/?waba_id=${encodeURIComponent(wabaId)}`,
 '_blank',
 'noopener,noreferrer'
 )
 }
 className="border-border bg-transparent text-foreground hover:bg-accent"
 title="Open WhatsApp Manager to create or edit templates for approval, then Sync from Meta to pull them in"
 >
 Manage Templates on Meta
 <ExternalLink className="size-4" />
 </Button>
 )}
 </div>
 </div>

 {templates.length === 0 ? (
 <Card className="bg-background border-border ring-0 ring-transparent">
 <CardContent className="flex flex-col items-center justify-center py-12 text-center">
 <p className="text-muted-foreground text-sm">No templates yet.</p>
 <p className="text-muted-foreground text-xs mt-1">Create your first message template to get started.</p>
 </CardContent>
 </Card>
 ) : (
 <div className="grid gap-3">
 {templates.map((template) => (
 <Card key={template.id} className="bg-background border-border ring-0 ring-transparent">
 <CardContent className="flex items-start justify-between pt-4">
 <div className="space-y-2 min-w-0 flex-1">
 <div className="flex items-center gap-2 flex-wrap">
 <h3 className="font-medium text-foreground">{template.name}</h3>
 <Badge
 className={`text-xs border ${categoryColors[template.category] || ''}`}
 >
 {template.category}
 </Badge>
 <Badge
 className={`text-xs border ${statusColors[template.status || 'Draft'] || ''}`}
 >
 {template.status || 'Draft'}
 </Badge>
 {template.language && (
 <span className="text-xs text-muted-foreground uppercase">{template.language}</span>
 )}
 </div>
 <p className="text-sm text-muted-foreground line-clamp-2">{template.body_text}</p>
 {template.footer_text && (
 <p className="text-xs text-muted-foreground italic">{template.footer_text}</p>
 )}
 </div>
 <Button
 variant="ghost"
 size="icon"
 onClick={() => handleDelete(template.id)}
 className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 shrink-0 ml-2"
 >
 <Trash2 className="size-4" />
 </Button>
 </CardContent>
 </Card>
 ))}
 </div>
 )}

 {/* Template builder — submits to Meta for review */}
 <TemplateBuilder
 open={dialogOpen}
 onOpenChange={setDialogOpen}
 wabaId={wabaId}
 onCreated={() => {
 if (user) fetchTemplates(user.id);
 }}
 />
 </div>
 );
}
