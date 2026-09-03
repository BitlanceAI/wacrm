"use client";

import { useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CannedReply } from "@/types";

interface CannedReplyPickerProps {
    replies: CannedReply[];
    /** Index of the keyboard-highlighted row, owned by the composer. */
    activeIndex: number;
    onHover: (index: number) => void;
    onSelect: (reply: CannedReply) => void;
}

/**
 * Slash-command list that floats above the composer. Keyboard handling
 * deliberately lives in the composer's textarea (arrow keys, Enter and
 * Escape must not require the list to hold focus, or every keystroke
 * would fight the text input) — this component only renders and
 * reports mouse intent.
 */
export function CannedReplyPicker({
    replies,
    activeIndex,
    onHover,
    onSelect,
}: CannedReplyPickerProps) {
    const activeRef = useRef<HTMLButtonElement>(null);

    // Keep the highlighted row visible when arrowing past the fold.
    useEffect(() => {
        activeRef.current?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    if (replies.length === 0) {
        return (
            <div className="mb-2 rounded-xl border border-border bg-background p-3 shadow-lg">
                <p className="text-xs text-muted-foreground">
                    No quick reply matches. Add one in Settings → Quick Replies.
                </p>
            </div>
        );
    }

    return (
        <div className="mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-background shadow-lg">
            {replies.map((reply, index) => (
                <button
                    key={reply.id}
                    ref={index === activeIndex ? activeRef : undefined}
                    type="button"
                    // onMouseDown, not onClick: the textarea keeps focus and a
                    // click would otherwise blur-then-select, closing the
                    // picker before the selection lands.
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onSelect(reply);
                    }}
                    onMouseEnter={() => onHover(index)}
                    className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                        index === activeIndex ? "bg-accent" : "hover:bg-accent/60"
                    )}
                >
                    <Zap className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                            <span className="text-xs font-medium text-foreground">
                                {reply.title}
                            </span>
                            <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground">
                                /{reply.shortcut}
                            </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                            {reply.body}
                        </span>
                    </span>
                </button>
            ))}
        </div>
    );
}
