"use client";

import Link from "next/link";
import { LogOut, Settings, LifeBuoy } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/server/actions/auth";

export function UserMenu({ name, email, avatarUrl, initials, settingsHref, supportHref, roleLabel }: {
  name: string;
  email: string;
  avatarUrl?: string | null;
  initials: string;
  settingsHref: string;
  supportHref?: string;
  roleLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Menu du compte">
        <Avatar className="size-8">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback className="bg-brand-soft text-xs font-semibold text-brand">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
          <p className="mt-1 text-[0.7rem] text-brand">{roleLabel}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={settingsHref}>
            <Settings /> Paramètres
          </Link>
        </DropdownMenuItem>
        {supportHref && (
          <DropdownMenuItem asChild>
            <Link href={supportHref}>
              <LifeBuoy /> Support Packio
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full">
              <LogOut /> Se déconnecter
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
