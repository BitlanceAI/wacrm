"use client";

import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

const pageTitles: Record<string, string> = {
 "/dashboard": "Dashboard",
 "/inbox": "Inbox",
 "/contacts": "Contacts",
 "/pipelines": "Pipelines",
 "/broadcasts": "Broadcasts",
 "/automations": "Automations",
 "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
 if (pageTitles[pathname]) return pageTitles[pathname];
 const match = Object.entries(pageTitles).find(([path]) =>
 pathname.startsWith(path),
 );
 return match ? match[1] : "Dashboard";
}

interface HeaderProps {
 /** Wired to the shell's drawer state. Used only on mobile — the
 * hamburger button is hidden on lg+. */
 onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
 const pathname = usePathname();
 const title = getPageTitle(pathname);

 return (
 <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 lg:px-6">
 <div className="flex min-w-0 items-center gap-2">
 {/* Hamburger — mobile only. 44×44 hit target per Apple HIG. */}
 <button
 type="button"
 onClick={onOpenSidebar}
 aria-label="Open menu"
 className="flex h-10 w-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
 >
 <Menu className="h-5 w-5" />
 </button>
 <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
 {title}
 </h1>
 </div>
 </header>
 );
}
