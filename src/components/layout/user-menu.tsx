"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useShell } from "@/components/layout/shell-context";
import { publicStorageUrl } from "@/lib/storage";
import { InstallAppMenuItem } from "@/components/layout/pwa";

export function UserMenu() {
  const { access } = useShell();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Account menu">
        <UserAvatar name={access.full_name || access.email} src={publicStorageUrl("avatars", access.avatar_path)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="truncate text-sm font-medium text-foreground">{access.full_name || "Your account"}</p>
          <p className="truncate text-xs font-normal">{access.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile"><UserRound />Profile</Link>
        </DropdownMenuItem>
        <InstallAppMenuItem />
        <DropdownMenuSeparator />
        <form action="/auth/signout" method="post">
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full"><LogOut />Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
