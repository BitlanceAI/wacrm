"use client";

import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { deleteUser } from "./actions";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, Key, Search } from "lucide-react";
import { UpdatePasswordModal } from "./update-password-modal";
import type { TenantStats } from "@/lib/admin/queries";

interface AdminUsersTableProps {
  initialTenants: TenantStats[];
}

const numFmt = new Intl.NumberFormat("en-IN");

function WhatsAppBadge({ status }: { status: string | null }) {
  if (status === "connected") {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-500">
        Connected
      </span>
    );
  }
  if (status) {
    return (
      <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
        Disconnected
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function AdminUsersTable({ initialTenants }: AdminUsersTableProps) {
  const [tenants, setTenants] = useState(initialTenants);
  const [query, setQuery] = useState("");
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        (t.full_name ?? "").toLowerCase().includes(q) ||
        t.email.toLowerCase().includes(q)
    );
  }, [tenants, query]);

  const handleDelete = async (userId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this user? This will remove all their contacts, conversations, and data."
      )
    ) {
      return;
    }

    try {
      setIsDeleting(userId);
      await deleteUser(userId);
      setTenants((prev) => prev.filter((t) => t.user_id !== userId));
      toast.success("User deleted successfully.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete user"
      );
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border p-3">
        <p className="text-sm font-medium text-foreground">
          Tenants{" "}
          <span className="text-muted-foreground">({filtered.length})</span>
        </p>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or email…"
            className="h-8 border-border bg-accent pl-8 text-sm text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>WhatsApp</TableHead>
            <TableHead className="text-right">Contacts</TableHead>
            <TableHead className="text-right">Messages (30d)</TableHead>
            <TableHead className="text-right">Broadcasts</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-[60px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="h-24 text-center">
                {query ? "No tenants match your search." : "No users found."}
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((t) => (
              <TableRow key={t.user_id}>
                <TableCell>
                  <p className="font-medium text-foreground">
                    {t.full_name || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.email}</p>
                </TableCell>
                <TableCell>
                  <WhatsAppBadge status={t.whatsapp_status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {numFmt.format(t.contacts_count)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {numFmt.format(t.messages_30d)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    / {numFmt.format(t.messages_count)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {numFmt.format(t.broadcasts_count)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t.last_message_at
                    ? formatDistanceToNow(new Date(t.last_message_at), {
                        addSuffix: true,
                      })
                    : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t.created_at
                    ? format(new Date(t.created_at), "MMM d, yyyy")
                    : "—"}
                </TableCell>
                <TableCell>
                  {t.email !== "bitlanceai@gmail.com" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            disabled={isDeleting === t.user_id}
                          >
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            setSelectedUserForPassword({
                              id: t.user_id,
                              name: t.full_name || t.email,
                            })
                          }
                        >
                          <Key className="mr-2 h-4 w-4" />
                          Update Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onClick={() => handleDelete(t.user_id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete User
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {selectedUserForPassword && (
        <UpdatePasswordModal
          userId={selectedUserForPassword.id}
          userName={selectedUserForPassword.name}
          open={!!selectedUserForPassword}
          onOpenChange={(open) => {
            if (!open) setSelectedUserForPassword(null);
          }}
        />
      )}
    </>
  );
}
