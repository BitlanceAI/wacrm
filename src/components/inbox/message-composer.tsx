"use client";

import {
 useState,
 useRef,
 useCallback,
 useEffect,
 useMemo,
 KeyboardEvent,
} from "react";
import { Send, LayoutTemplate } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
 extractSlashQuery,
 filterCannedReplies,
 renderCannedBody,
} from "@/lib/canned-replies/match";
import type { CannedReply } from "@/types";
import { ReplyQuote } from "./reply-quote";
import { CannedReplyPicker } from "./canned-reply-picker";

interface ReplyDraft {
 /** Internal UUID of the message being replied to — sent back through onSend. */
 id: string;
 authorLabel: string;
 preview: string;
}

interface MessageComposerProps {
 conversationId: string;
 sessionExpired: boolean;
 onSend: (text: string, replyToId?: string) => void;
 onOpenTemplates: () => void;
 replyTo?: ReplyDraft | null;
 onClearReply?: () => void;
 /**
  * Values for {{key}} placeholders in canned replies — the active
  * contact's fields. Unknown keys are left visible in the draft so a
  * half-filled sentence can't reach the customer unnoticed.
  */
 cannedPlaceholders?: Record<string, string | null | undefined>;
}

export function MessageComposer({
 conversationId,
 sessionExpired,
 onSend,
 onOpenTemplates,
 replyTo,
 onClearReply,
 cannedPlaceholders,
}: MessageComposerProps) {
 const [text, setText] = useState("");
 const [sending, setSending] = useState(false);
 const textareaRef = useRef<HTMLTextAreaElement>(null);

 // ── Canned replies ("/shortcut") ──────────────────────────────────
 const [cannedReplies, setCannedReplies] = useState<CannedReply[]>([]);
 const [activeIndex, setActiveIndex] = useState(0);
 /** Set by Escape; cleared as soon as the draft changes again, so the
  * picker stays dismissed for the current token only. */
 const [pickerDismissed, setPickerDismissed] = useState(false);

 // One fetch per mount. A desk's snippet list is small and changes
 // rarely — refetching per keystroke would be pure waste.
 useEffect(() => {
 let cancelled = false;
 (async () => {
 const supabase = createClient();
 const { data, error } = await supabase
 .from("canned_replies")
 .select("*")
 .order("usage_count", { ascending: false });
 if (error) {
 console.error("Failed to load canned replies:", error.message);
 return;
 }
 if (!cancelled) setCannedReplies((data ?? []) as CannedReply[]);
 })();
 return () => {
 cancelled = true;
 };
 }, []);

 const slashQuery = pickerDismissed ? null : extractSlashQuery(text);
 const matches = useMemo(
 () =>
 slashQuery === null ? [] : filterCannedReplies(cannedReplies, slashQuery),
 [slashQuery, cannedReplies],
 );
 const pickerOpen = slashQuery !== null;

 const applyCannedReply = useCallback(
 (reply: CannedReply) => {
 setText(renderCannedBody(reply.body, cannedPlaceholders ?? {}));
 setPickerDismissed(true);
 textareaRef.current?.focus();

 // Usage bump is fire-and-forget: it only affects picker ordering,
 // and failing it must never cost the agent their draft.
 void createClient()
 .rpc("increment_canned_reply_usage", { reply_id: reply.id })
 .then(({ error }: { error: { message: string } | null }) => {
 if (error) {
 console.error("Canned reply usage bump failed:", error.message);
 }
 });
 },
 [cannedPlaceholders],
 );

 const adjustHeight = useCallback(() => {
 const el = textareaRef.current;
 if (!el) return;
 el.style.height = "auto";
 // Max 4 lines (~96px)
 el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
 }, []);

 const handleSend = useCallback(async () => {
 const trimmed = text.trim();
 if (!trimmed || sending || sessionExpired) return;

 setSending(true);
 try {
 onSend(trimmed, replyTo?.id);
 setText("");
 if (textareaRef.current) {
 textareaRef.current.style.height = "auto";
 }
 } finally {
 setSending(false);
 }
 }, [text, sending, sessionExpired, onSend, replyTo?.id]);

 const handleKeyDown = useCallback(
 (e: KeyboardEvent<HTMLTextAreaElement>) => {
 // While the slash picker is open it owns the navigation keys —
 // otherwise Enter would send a literal "/ref" to the customer.
 if (pickerOpen) {
 if (e.key === "Escape") {
 e.preventDefault();
 setPickerDismissed(true);
 return;
 }
 if (matches.length > 0) {
 if (e.key === "ArrowDown") {
 e.preventDefault();
 setActiveIndex((i) => (i + 1) % matches.length);
 return;
 }
 if (e.key === "ArrowUp") {
 e.preventDefault();
 setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
 return;
 }
 if (e.key === "Enter" || e.key === "Tab") {
 e.preventDefault();
 applyCannedReply(matches[Math.min(activeIndex, matches.length - 1)]);
 return;
 }
 }
 }

 if (e.key === "Enter" && !e.shiftKey) {
 e.preventDefault();
 handleSend();
 }
 },
 [handleSend, pickerOpen, matches, activeIndex, applyCannedReply]
 );

 const handleChange = useCallback(
 (e: React.ChangeEvent<HTMLTextAreaElement>) => {
 setText(e.target.value);
 setPickerDismissed(false);
 setActiveIndex(0);
 adjustHeight();
 },
 [adjustHeight]
 );

 return (
 <div className="border-t border-border bg-background p-3">
 {pickerOpen && !sessionExpired && (
 <CannedReplyPicker
 replies={matches}
 activeIndex={Math.min(activeIndex, Math.max(0, matches.length - 1))}
 onHover={setActiveIndex}
 onSelect={applyCannedReply}
 />
 )}
 {replyTo && (
 <div className="mb-2">
 <ReplyQuote
 authorLabel={replyTo.authorLabel}
 preview={replyTo.preview}
 onDismiss={onClearReply}
 />
 </div>
 )}
 {sessionExpired && (
 <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2">
 <p className="text-xs text-amber-400">
 24-hour session expired. Use a template to re-engage.
 </p>
 <Button
 variant="ghost"
 size="sm"
 className="h-7 text-xs text-amber-400 hover:text-amber-300"
 onClick={onOpenTemplates}
 >
 <LayoutTemplate className="mr-1 h-3 w-3" />
 Templates
 </Button>
 </div>
 )}

 <div className="flex items-end gap-2">
 <Button
 variant="ghost"
 size="sm"
 className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-foreground"
 onClick={onOpenTemplates}
 title="Send template"
 >
 <LayoutTemplate className="h-4 w-4" />
 </Button>

 <textarea
 ref={textareaRef}
 value={text}
 onChange={handleChange}
 onKeyDown={handleKeyDown}
 placeholder={
 sessionExpired
 ? "Session expired - use a template"
 : "Type a message... (Shift+Enter for new line)"
 }
 disabled={sessionExpired}
 rows={1}
 className={cn(
 "flex-1 resize-none rounded-xl border border-border bg-accent px-4 py-2.5 text-sm text-foreground placeholder-slate-500 outline-none transition-colors focus:border-primary/50",
 sessionExpired && "cursor-not-allowed opacity-50"
 )}
 />

 <Button
 size="sm"
 className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90 disabled:opacity-40"
 disabled={!text.trim() || sessionExpired || sending}
 onClick={handleSend}
 >
 <Send className="h-4 w-4" />
 </Button>
 </div>

 {/* Hint sits outside the flex row so its height doesn't push
 `items-end` buttons below the textarea. Indented to line up
 under the textarea left edge (w-9 button + gap-2 = 44px). */}
 <p className="mt-1 pl-11 text-[10px] text-slate-600">
 Type &apos;/&apos; for quick replies
 </p>
 </div>
 );
}
