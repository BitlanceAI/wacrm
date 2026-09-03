'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import {
    DEFAULT_BUSINESS_HOURS,
    DAY_LABELS,
    validateSchedule,
    type BusinessDay,
} from '@/lib/support/business-hours';
import { useTenant } from '@/hooks/use-tenant';

/**
 * Common IANA zones, India first — the deployment's primary market.
 * A free-text field would let a typo silently disable business hours
 * (Intl throws on an unknown zone), so the choice is constrained.
 */
const TIMEZONES = [
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Singapore',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Australia/Sydney',
    'UTC',
];

interface InboxSettings {
    timezone: string;
    business_hours: BusinessDay[];
    away_enabled: boolean;
    away_message: string;
    away_cooldown_minutes: number;
    csat_enabled: boolean;
    csat_question: string;
}

const DEFAULTS: InboxSettings = {
    timezone: 'Asia/Kolkata',
    business_hours: DEFAULT_BUSINESS_HOURS,
    away_enabled: false,
    away_message:
        "Thanks for your message! Our team is away right now. We'll reply as soon as we're back.",
    away_cooldown_minutes: 240,
    csat_enabled: false,
    csat_question: 'How would you rate the support you received today?',
};

/**
 * Business hours, out-of-hours auto-reply and CSAT config — the three
 * settings that decide what happens to a customer message nobody is
 * around to read.
 */
export function SupportDeskPanel() {
    const supabase = createClient();
    const { user, loading: authLoading } = useAuth();
    const { tenantId } = useTenant();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState<InboxSettings>(DEFAULTS);

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            setLoading(false);
            return;
        }
        void (async () => {
            const { data, error } = await supabase
                .from('inbox_settings')
                .select('*')
                .maybeSingle();
            setLoading(false);
            if (error) {
                toast.error('Failed to load support settings');
                return;
            }
            // No row yet is the normal first-run state, not an error —
            // the defaults below match the column defaults in migration 017.
            if (data) {
                setSettings({
                    timezone: data.timezone,
                    business_hours: data.business_hours ?? DEFAULT_BUSINESS_HOURS,
                    away_enabled: data.away_enabled,
                    away_message: data.away_message,
                    away_cooldown_minutes: data.away_cooldown_minutes,
                    csat_enabled: data.csat_enabled,
                    csat_question: data.csat_question,
                });
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, user?.id]);

    function updateDay(dow: number, patch: Partial<BusinessDay>) {
        setSettings((prev) => ({
            ...prev,
            business_hours: prev.business_hours.map((d) =>
                d.dow === dow ? { ...d, ...patch } : d,
            ),
        }));
    }

    async function handleSave() {
        if (!user) return;

        const problems = validateSchedule(settings.business_hours);
        if (problems.length > 0) {
            toast.error(problems[0]);
            return;
        }

        setSaving(true);
        const { error } = await supabase.from('inbox_settings').upsert(
            {
                user_id: tenantId,
                ...settings,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
        );
        setSaving(false);

        if (error) {
            toast.error(`Failed to save: ${error.message}`);
            return;
        }
        toast.success('Support settings saved');
    }

    if (loading) {
        return (
            <Card className="border-border bg-background">
                <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading support settings…
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            {/* ── Business hours ─────────────────────────────────── */}
            <Card className="border-border bg-background">
                <CardContent className="space-y-4 pt-6">
                    <div>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Clock className="size-4 text-primary" />
                            Business hours
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                            When your desk is open. Drives the out-of-hours auto-reply. Set a
                            closing time earlier than the opening time for an overnight shift.
                        </p>
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Timezone</Label>
                        <select
                            value={settings.timezone}
                            onChange={(e) =>
                                setSettings((p) => ({ ...p, timezone: e.target.value }))
                            }
                            className="h-8 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground"
                        >
                            {TIMEZONES.map((tz) => (
                                <option key={tz} value={tz}>
                                    {tz}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-2">
                        {settings.business_hours
                            .slice()
                            .sort((a, b) => a.dow - b.dow)
                            .map((day) => (
                                <div
                                    key={day.dow}
                                    className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-2"
                                >
                                    <span className="w-24 text-xs text-foreground">
                                        {DAY_LABELS[day.dow]}
                                    </span>
                                    <Switch
                                        checked={!day.closed}
                                        onCheckedChange={(open) =>
                                            updateDay(day.dow, { closed: !open })
                                        }
                                    />
                                    {day.closed ? (
                                        <span className="text-xs text-muted-foreground">Closed</span>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="time"
                                                value={day.open}
                                                onChange={(e) =>
                                                    updateDay(day.dow, { open: e.target.value })
                                                }
                                                className="h-8 w-28 text-sm"
                                            />
                                            <span className="text-xs text-muted-foreground">to</span>
                                            <Input
                                                type="time"
                                                value={day.close}
                                                onChange={(e) =>
                                                    updateDay(day.dow, { close: e.target.value })
                                                }
                                                className="h-8 w-28 text-sm"
                                            />
                                        </div>
                                    )}
                                </div>
                            ))}
                    </div>
                </CardContent>
            </Card>

            {/* ── Away message ───────────────────────────────────── */}
            <Card className="border-border bg-background">
                <CardContent className="space-y-3 pt-6">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-medium text-foreground">
                                Out-of-hours auto-reply
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Sent once per customer per cooldown window when a message arrives
                                outside business hours. The thread still counts as awaiting a
                                reply — an apology isn&apos;t an answer.
                            </p>
                        </div>
                        <Switch
                            checked={settings.away_enabled}
                            onCheckedChange={(v) =>
                                setSettings((p) => ({ ...p, away_enabled: v }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Message</Label>
                        <Textarea
                            value={settings.away_message}
                            onChange={(e) =>
                                setSettings((p) => ({ ...p, away_message: e.target.value }))
                            }
                            rows={3}
                            className="text-sm"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">
                            Cooldown (minutes)
                        </Label>
                        <Input
                            type="number"
                            min={0}
                            max={10080}
                            value={settings.away_cooldown_minutes}
                            onChange={(e) =>
                                setSettings((p) => ({
                                    ...p,
                                    away_cooldown_minutes: Number(e.target.value),
                                }))
                            }
                            className="h-8 w-32 text-sm"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* ── CSAT ───────────────────────────────────────────── */}
            <Card className="border-border bg-background">
                <CardContent className="space-y-3 pt-6">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-medium text-foreground">
                                Satisfaction survey
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Sent as a 1-5 rating list when an agent closes a conversation. One
                                survey per resolution.
                            </p>
                        </div>
                        <Switch
                            checked={settings.csat_enabled}
                            onCheckedChange={(v) =>
                                setSettings((p) => ({ ...p, csat_enabled: v }))
                            }
                        />
                    </div>

                    <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Question</Label>
                        <Input
                            value={settings.csat_question}
                            onChange={(e) =>
                                setSettings((p) => ({ ...p, csat_question: e.target.value }))
                            }
                            className="h-8 text-sm"
                        />
                    </div>
                </CardContent>
            </Card>

            <Button onClick={handleSave} disabled={saving}>
                {saving ? (
                    <Loader2 className="size-3.5 animate-spin" />
                ) : (
                    <Save className="size-3.5" />
                )}
                Save support settings
            </Button>
        </div>
    );
}
