'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    CalendarClock,
    Loader2,
    Plus,
    MapPin,
    Check,
    X,
    Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
    REMINDER_PRESETS,
    formatAppointmentTime,
} from '@/lib/appointments/scheduling';
import type { Appointment, AppointmentStatus, Contact } from '@/types';

const STATUS_STYLES: Record<AppointmentStatus, string> = {
    scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    confirmed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    completed: 'bg-slate-500/10 text-muted-foreground border-border',
    cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
    no_show: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
    scheduled: 'Scheduled',
    confirmed: 'Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'No show',
};

/**
 * Convert a datetime-local value ("2026-08-27T15:00") into an ISO
 * instant. The input has no zone, so it is interpreted in the browser's
 * — which is what the person booking actually means when they type 3pm.
 */
function localInputToIso(value: string): string {
    return new Date(value).toISOString();
}

export default function AppointmentsPage() {
    const [appointments, setAppointments] = useState<Appointment[]>([]);
    const [loading, setLoading] = useState(true);
    const [showPast, setShowPast] = useState(false);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [contacts, setContacts] = useState<Pick<Contact, 'id' | 'name' | 'phone'>[]>([]);

    const [contactId, setContactId] = useState('');
    const [title, setTitle] = useState('');
    const [startsAt, setStartsAt] = useState('');
    const [location, setLocation] = useState('');
    const [notes, setNotes] = useState('');
    const [offsets, setOffsets] = useState<number[]>([24 * 60, 60]);

    const browserZone = useMemo(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
        [],
    );

    const load = useCallback(async () => {
        // No setLoading(true) here: `loading` already starts true for the
        // first paint, and setting state synchronously inside the mount
        // effect trips React's cascading-render rule. Refreshes replace
        // the rows in place instead of flashing a spinner.
        const params = new URLSearchParams();
        if (showPast) params.set('from', 'all');
        const res = await fetch(`/api/appointments?${params.toString()}`);
        setLoading(false);
        if (!res.ok) {
            toast.error('Failed to load appointments');
            return;
        }
        const data = await res.json();
        setAppointments(data.appointments ?? []);
    }, [showPast]);

    useEffect(() => {
        void load();
    }, [load]);

    // Contacts are only needed once the booking dialog opens.
    useEffect(() => {
        if (!dialogOpen || contacts.length > 0) return;
        void (async () => {
            const supabase = createClient();
            const { data } = await supabase
                .from('contacts')
                .select('id, name, phone')
                .order('name')
                .limit(500);
            setContacts(data ?? []);
        })();
    }, [dialogOpen, contacts.length]);

    function toggleOffset(minutes: number) {
        setOffsets((prev) =>
            prev.includes(minutes)
                ? prev.filter((m) => m !== minutes)
                : [...prev, minutes],
        );
    }

    async function handleCreate() {
        if (!contactId || !title.trim() || !startsAt) {
            toast.error('Contact, title and start time are required');
            return;
        }
        setSaving(true);
        const res = await fetch('/api/appointments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contact_id: contactId,
                title: title.trim(),
                starts_at: localInputToIso(startsAt),
                location: location.trim() || null,
                notes: notes.trim() || null,
                timezone: browserZone,
                reminder_offsets: offsets,
            }),
        });
        setSaving(false);

        const data = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 207) {
            toast.error(data.error ?? 'Failed to create appointment');
            return;
        }
        if (data.warning) {
            toast.warning(data.warning);
        } else {
            // Saying how many reminders were dropped as already-past
            // avoids the "I ticked 24 hours and nothing was scheduled"
            // confusion on same-day bookings.
            const skipped = data.reminders_skipped_as_past ?? 0;
            toast.success(
                skipped > 0
                    ? `Booked — ${data.reminders_created} reminder(s) set, ${skipped} skipped as already past`
                    : `Booked — ${data.reminders_created} reminder(s) set`,
            );
        }

        setDialogOpen(false);
        setTitle('');
        setStartsAt('');
        setLocation('');
        setNotes('');
        void load();
    }

    async function updateStatus(id: string, status: AppointmentStatus) {
        const res = await fetch(`/api/appointments/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        if (!res.ok) {
            toast.error('Failed to update appointment');
            return;
        }
        toast.success(`Marked ${STATUS_LABELS[status].toLowerCase()}`);
        void load();
    }

    async function remove(id: string) {
        const res = await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            toast.error('Failed to delete appointment');
            return;
        }
        setAppointments((prev) => prev.filter((a) => a.id !== id));
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Appointments</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Bookings with automatic WhatsApp reminders. Free-text reminders only
                        reach customers inside the 24-hour service window — for bookings
                        further out, use an approved template.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPast((v) => !v)}
                    >
                        {showPast ? 'Upcoming only' : 'Include past'}
                    </Button>
                    <Button size="sm" onClick={() => setDialogOpen(true)}>
                        <Plus className="size-3.5" />
                        New booking
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading appointments…
                </div>
            ) : appointments.length === 0 ? (
                <div className="rounded-xl border border-border bg-background py-16 text-center">
                    <CalendarClock className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 text-sm text-foreground">No appointments yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        Book one and the reminders schedule themselves.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {appointments.map((appt) => (
                        <div
                            key={appt.id}
                            className="flex flex-wrap items-start gap-3 rounded-xl border border-border bg-background p-4"
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-medium text-foreground">
                                        {appt.title}
                                    </span>
                                    <span
                                        className={cn(
                                            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                            STATUS_STYLES[appt.status],
                                        )}
                                    >
                                        {STATUS_LABELS[appt.status]}
                                    </span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    {appt.contact?.name || appt.contact?.phone || 'Unknown contact'}
                                    {' · '}
                                    {formatAppointmentTime(appt.starts_at, appt.timezone)}
                                    {appt.location && (
                                        <span className="ml-2 inline-flex items-center gap-1">
                                            <MapPin className="size-3" />
                                            {appt.location}
                                        </span>
                                    )}
                                </p>
                                {appt.notes && (
                                    <p className="mt-1 text-xs text-muted-foreground">{appt.notes}</p>
                                )}
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                {appt.status === 'scheduled' && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs text-emerald-400"
                                        onClick={() => updateStatus(appt.id, 'confirmed')}
                                    >
                                        <Check className="size-3.5" />
                                        Confirm
                                    </Button>
                                )}
                                {(appt.status === 'scheduled' || appt.status === 'confirmed') && (
                                    <>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs"
                                            onClick={() => updateStatus(appt.id, 'completed')}
                                        >
                                            Complete
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-xs text-red-400"
                                            onClick={() => updateStatus(appt.id, 'cancelled')}
                                        >
                                            <X className="size-3.5" />
                                            Cancel
                                        </Button>
                                    </>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="size-7 p-0 text-muted-foreground hover:text-red-400"
                                    onClick={() => remove(appt.id)}
                                    aria-label="Delete appointment"
                                >
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="border-border bg-background">
                    <DialogHeader>
                        <DialogTitle>New booking</DialogTitle>
                        <DialogDescription>
                            Times are in your browser&apos;s timezone ({browserZone}).
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Contact</Label>
                            <select
                                value={contactId}
                                onChange={(e) => setContactId(e.target.value)}
                                className="h-8 w-full rounded-md border border-border bg-accent px-2 text-sm text-foreground"
                            >
                                <option value="">Select a contact…</option>
                                {contacts.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.name || c.phone}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Title</Label>
                            <Input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Consultation"
                                className="h-8 text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Starts at</Label>
                            <Input
                                type="datetime-local"
                                value={startsAt}
                                onChange={(e) => setStartsAt(e.target.value)}
                                className="h-8 text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Location</Label>
                            <Input
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="Clinic 2 / Zoom link"
                                className="h-8 text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Notes</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                className="text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs text-muted-foreground">Reminders</Label>
                            <div className="flex flex-wrap gap-2">
                                {REMINDER_PRESETS.map((preset) => (
                                    <button
                                        key={preset.minutes}
                                        type="button"
                                        onClick={() => toggleOffset(preset.minutes)}
                                        className={cn(
                                            'rounded-full border px-2.5 py-1 text-xs transition-colors',
                                            offsets.includes(preset.minutes)
                                                ? 'border-primary/40 bg-primary/10 text-primary'
                                                : 'border-border text-muted-foreground hover:text-foreground',
                                        )}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                                Lead times already in the past are skipped rather than fired
                                immediately.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button onClick={handleCreate} disabled={saving}>
                            {saving && <Loader2 className="size-3.5 animate-spin" />}
                            Book
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
