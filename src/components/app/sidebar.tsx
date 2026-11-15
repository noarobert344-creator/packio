"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { NAV, type NavGroup } from "./nav-config";

type Role = "CUSTOMER" | "PREPARER" | "ADMIN";

function NavList({ groups, badges, onNavigate }: { groups: NavGroup[]; badges: Record<string, number>; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5" aria-label="Navigation principale">
      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-0.5">
          {group.label && <p className="px-3 pb-1 text-[0.68rem] font-semibold tracking-wider text-muted-foreground/80 uppercase">{group.label}</p>}
          {group.items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const badge = item.badgeKey ? badges[item.badgeKey] : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                  active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                )}
              >
                <item.icon className={cn("size-4 shrink-0", active ? "text-brand" : "text-muted-foreground group-hover:text-foreground")} />
                <span className="truncate">{item.label}</span>
                {badge > 0 && (
                  <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[0.7rem] font-semibold text-brand-foreground tabular">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

const SPACE_LABEL: Record<Role, string> = { CUSTOMER: "Espace client", PREPARER: "Espace préparateur", ADMIN: "Back-office" };

export function Sidebar({ role, badges, footer }: { role: Role; badges: Record<string, number>; footer?: React.ReactNode }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-16 items-center gap-2 px-4">
        <Link href="/" aria-label="Accueil Packio">
          <Logo />
        </Link>
        <span className="ml-auto shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.62rem] font-medium whitespace-nowrap text-muted-foreground">{SPACE_LABEL[role]}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <NavList groups={NAV[role]} badges={badges} />
      </div>
      {footer && <div className="border-t p-3">{footer}</div>}
    </aside>
  );
}

export function MobileNav({ role, badges, footer }: { role: Role; badges: Record<string, number>; footer?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Ouvrir le menu">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[18rem] bg-sidebar p-0">
        <SheetHeader className="h-16 justify-center border-b px-5">
          <SheetTitle asChild>
            <Link href="/" onClick={() => setOpen(false)}>
              <Logo />
            </Link>
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <NavList groups={NAV[role]} badges={badges} onNavigate={() => setOpen(false)} />
        </div>
        {footer && <div className="border-t p-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}
