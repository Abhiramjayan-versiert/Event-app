"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useShell } from "@/components/layout/shell-context";
import { publicStorageUrl } from "@/lib/storage";
import { InstallAppMenuItem } from "@/components/layout/pwa";

async function signOut() {
  try {
    await fetch("/auth/signout", { method: "POST", credentials: "same-origin", redirect: "manual" });
  } finally {
    // Full page load so no signed-in screens stay in memory.
    window.location.replace("/login");
  }
}

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
        {/* The menu unmounts on select, which would cancel a <form> submit, so sign out with fetch. */}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void signOut();
          }}
        >
          <LogOut />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
