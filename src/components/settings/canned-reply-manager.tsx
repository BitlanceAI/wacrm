'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { normalizeShortcut, isValidShortcut } from '@/lib/canned-replies/match';
import type { CannedReply } from '@/types';

/**
 * Quick replies = local text snippets the inbox composer inserts when
 * an agent types "/shortcut". They are NOT Meta templates: no approval
 * step, editable instantly, and only valid inside the 24-hour service
 * window. That distinction is the whole reason the feature exists
 * alongside Templates rather than inside it.
 */
export function CannedReplyManager() {
    const supabase = createClient();
    const { user, loading: authLoading } = useAuth();

    const [loading, setLoading] = useState(true);
    const [replies, setReplies] = useState<CannedReply[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState<CannedReply | null>(null);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const [shortcut, setShortcut] = useState('');
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            setLoading(false);
            return;
        }
        void fetchReplies();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user?.id]);

    async function fetchReplies() {
        setLoading(true);
        const { data, error } = await supabase
            .from('canned_replies')
            .select('*')
            .order('usage_count', { ascending: false });
        setLoading(false);
        if (error) {
            toast.error('Failed to load quick replies');
            return;
        }
        setReplies((data ?? []) as CannedReply[]);
    }

    function openCreate() {
        setEditing(null);
        setShortcut('');
        setTitle('');
        setBody('');
        setDialogOpen(true);
    }

    function openEdit(reply: CannedReply) {
        setEditing(reply);
        setShortcut(reply.shortcut);
        setTitle(reply.title);
        setBody(reply.body);
        setDialogOpen(true);
    }

    async function handleSave() {
        if (!user) return;

        const normalized = normalizeShortcut(shortcut);
        if (!isValidShortcut(normalized)) {
            toast.error('Shortcut must be 1-32 letters, numbers, - or _');
            return;
        }
        if (!title.trim() || !body.trim()) {
            toast.error('Title and message are both required');
            return;
        }

        setSaving(true);
        const payload = {
            user_id: user.id,
            shortcut: normalized,
            title: title.trim(),
            body: body.trim(),
            updated_at: new Date().toISOString(),
        };

        const { error } = editing
            ? await supabase.from('canned_replies').update(payload).eq('id', editing.id)
            : await supabase.from('canned_replies').insert(payload);
        setSaving(false);

        if (error) {
            // 23505 = the (user_id, shortcut) unique index. Saying which
            // shortcut collided is far more use than the raw constraint name.
            toast.error(
                error.code === '23505'
                    ? `You already have a quick reply for /${normalized}`
                    : 'Failed to save quick reply',
            );
            return;
        }

        toast.success(editing ? 'Quick reply updated' : 'Quick reply created');
        setDialogOpen(false);
        void fetchReplies();
    }

    async function handleDelete(reply: CannedReply) {
        setDeletingId(reply.id);
        const { error } = await supabase
            .from('canned_replies')
            .delete()
            .eq('id', reply.id);
        setDeletingId(null);
        if (error) {
            toast.error('Failed to delete quick reply');
            return;
        }
        toast.success(`Deleted /${reply.shortcut}`);
        setReplies((prev) => prev.filter((r) => r.id !== reply.id));
    }

    return (
        <Card className="border-border bg-background">
            <CardContent className="space-y-4 pt-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h3 className="text-sm font-medium text-foreground">Quick Replies</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            Type <code className="rounded bg-muted px-1">/shortcut</code> in the
                            inbox to insert one. Use{' '}
                            <code className="rounded bg-muted px-1">{'{{name}}'}</code>,{' '}
                            <code className="rounded bg-muted px-1">{'{{phone}}'}</code>,{' '}
                            <code className="rounded bg-muted px-1">{'{{email}}'}</code> or{' '}
                            <code className="rounded bg-muted px-1">{'{{company}}'}</code> to pull
                            in the contact&apos;s details.
                        </p>
                    </div>
                    <Button size="sm" onClick={openCreate} className="shrink-0">
                        <Plus className="size-3.5" />
                        New
                    </Button>
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Loading quick replies…
                    </div>
                ) : replies.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        No quick replies yet. Create one for the answer you retype most.
                    </p>
                ) : (
                    <div className="divide-y divide-border rounded-lg border border-border">
                        {replies.map((reply) => (
                            <div
                                key={reply.id}
                                className="flex items-start gap-3 p-3"
                            >
                                <Zap className="mt-0.5 size-3.5 shrink-0 text-primary" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-medium text-foreground">
                                            {reply.title}
                                        </span>
                                        <span className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                                            /{reply.shortcut}
                                        </span>
                                        {reply.usage_count > 0 && (
                                            <span className="text-[10px] text-muted-foreground">
                                                used {reply.usage_count}×
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                        {reply.body}
                                    </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="size-7 p-0"
                                        onClick={() => openEdit(reply)}
                                        aria-label={`Edit /${reply.shortcut}`}
                                    >
                                        <Pencil className="size-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="size-7 p-0 text-red-400 hover:text-red-300"
                                        disabled={deletingId === reply.id}
                                        onClick={() => handleDelete(reply)}
                                        aria-label={`Delete /${reply.shortcut}`}
                                    >
                                        {deletingId === reply.id ? (
                                            <Loader2 className="size-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="size-3.5" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>
                            {editing ? 'Edit quick reply' : 'New quick reply'}
                        </DialogTitle>
                        <DialogDescription>
                            Free text sent as a normal message — no Meta approval needed, so it
                            only works inside the 24-hour service window.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Shortcut</Label>
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">/</span>
                                <Input
                                    value={shortcut}
                                    onChange={(e) => setShortcut(e.target.value)}
                                    onBlur={() => setShortcut(normalizeShortcut(shortcut))}
                                    placeholder="hours"
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Title</Label>
                            <Input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Opening hours"
                                className="h-8 text-sm"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Message</Label>
                            <Textarea
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                rows={4}
                                placeholder="Hi {{name}}, we're open Monday to Saturday, 9am to 6pm."
                                className="text-sm"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="ghost"
                            onClick={() => setDialogOpen(false)}
                            disabled={saving}
                        >
                            Cancel
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            {editing ? 'Save changes' : 'Create'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}
