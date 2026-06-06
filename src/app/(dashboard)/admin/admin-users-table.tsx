"use client";

import { useState } from "react";
import { format } from "date-fns";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, Key } from "lucide-react";
import { UpdatePasswordModal } from "./update-password-modal";

interface Profile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  role: string | null;
  created_at: string | null;
}

interface AdminUsersTableProps {
  initialProfiles: Profile[];
}

export function AdminUsersTable({ initialProfiles }: AdminUsersTableProps) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [selectedUserForPassword, setSelectedUserForPassword] = useState<{ id: string; name: string } | null>(null);

  const handleDelete = async (userId: string) => {
    if (!confirm("Are you sure you want to delete this user? This will remove all their contacts, conversations, and data.")) {
      return;
    }

    try {
      setIsDeleting(userId);
      await deleteUser(userId);
      setProfiles((prev) => prev.filter((p) => p.user_id !== userId));
      toast.success("User deleted successfully.");
    } catch (error: any) {
      toast.error(error.message || "Failed to delete user");
    } finally {
      setIsDeleting(null);
    }
  };

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Full Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="w-[80px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {profiles.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center">
                No users found.
              </TableCell>
            </TableRow>
          ) : (
            profiles.map((profile) => (
              <TableRow key={profile.id}>
                <TableCell className="font-medium">
                  {profile.full_name || "—"}
                </TableCell>
                <TableCell>{profile.email}</TableCell>
                <TableCell className="capitalize">{profile.role || "user"}</TableCell>
                <TableCell>
                  {profile.created_at ? format(new Date(profile.created_at), "MMM d, yyyy") : "—"}
                </TableCell>
                <TableCell>
                  {profile.email !== "bitlanceai@gmail.com" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" className="h-8 w-8 p-0" disabled={isDeleting === profile.user_id}>
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => setSelectedUserForPassword({ id: profile.user_id, name: profile.full_name || profile.email })}
                        >
                          <Key className="mr-2 h-4 w-4" />
                          Update Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onClick={() => handleDelete(profile.user_id)}
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
