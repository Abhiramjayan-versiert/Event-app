"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar, SidebarContent } from "@/components/layout/sidebar";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ContextSwitcher } from "@/components/layout/context-switcher";
import { GlobalSearch } from "@/components/layout/global-search";
import { NotificationBell } from "@/components/layout/notification-bell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { UserMenu } from "@/components/layout/user-menu";
import { ShellProvider } from "@/components/layout/shell-context";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand/logo";
import type { AccessSummary } from "@/lib/auth/types";

export function AppShell({ access, children }: { access: AccessSummary; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <ShellProvider access={access}>
      <Sidebar />
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="border-sidebar-border p-0 text-sidebar-foreground [&>button]:text-white">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-1 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 lg:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu />
          </Button>
          <LogoMark className="lg:hidden" />
          <div className="hidden sm:block">
            <ContextSwitcher />
          </div>
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <GlobalSearch />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-5 lg:px-8 lg:py-8">{children}</main>
      </div>
    </ShellProvider>
  );
}
