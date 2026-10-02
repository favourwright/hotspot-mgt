"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LucideIcon, Menu, MoreVertical } from "lucide-react";

import { Button } from "@/components/system/button";
import { NavPill } from "@/components/system/nav-pill";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** Match the pathname exactly. Needed for index routes, whose href is a
   *  prefix of every sibling. */
  exact?: boolean;
  /** Opens in a new tab -- used for the standalone help pages. */
  external?: boolean;
}

interface TopNavProps {
  brand: { label: string; sublabel?: string; href: string };
  /** Rendered as the centred pill group. Keep this to ~5; past that the
   *  group stops reading as a single object and starts crowding the brand. */
  items: NavItem[];
  /** Secondary destinations, tucked into the overflow menu. */
  overflow?: NavItem[];
  user?: { name?: string | null; email?: string | null; avatarUrl?: string | null };
  onLogout?: () => void;
  /** Extra control in the right cluster -- e.g. a sign-in button for the
   *  logged-out customer portal, where there's no avatar to show. */
  action?: React.ReactNode;
}

function initials(value: string) {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

export function TopNav({
  brand,
  items,
  overflow = [],
  user,
  onLogout,
  action,
}: TopNavProps) {
  const pathname = usePathname();

  const isActive = (item: NavItem) => {
    if (item.external) return false;
    if (item.exact) return pathname === item.href;
    // `startsWith` alone would also match a sibling sharing this href's
    // prefix (/admin/billing vs /admin/billing-plans) -- require a full
    // path segment boundary.
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  };

  const allItems = [...items, ...overflow];

  return (
    <nav className="relative flex items-center gap-2 rounded-2xl bg-raised p-2">
      {/* Brand */}
      <Link
        href={brand.href}
        className="flex min-w-0 items-center gap-3 rounded-xl pr-3 transition-opacity hover:opacity-70"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-sunken text-sm font-semibold">
          {initials(brand.label)}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-semibold">
            {brand.label}
          </span>
          {brand.sublabel && (
            <span className="block truncate font-mono text-xs text-muted-foreground">
              {brand.sublabel}
            </span>
          )}
        </span>
      </Link>

      {/* Centred pill group. Absolutely positioned so it stays optically
          centred in the bar regardless of how wide the brand renders. */}
      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 lg:flex">
        {items.map((item) => (
          <NavPill key={item.href} href={item.href} active={isActive(item)}>
            {item.label}
          </NavPill>
        ))}
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2">
        {action}

        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More"
              render={<Button tone="sunken" scale="icon" />}
              className="hidden lg:inline-flex"
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {overflow.map((item) => (
                <DropdownMenuItem
                  key={item.href}
                  render={
                    <Link
                      href={item.href}
                      target={item.external ? "_blank" : undefined}
                    />
                  }
                >
                  {item.icon && <item.icon className="size-4" />}
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Below lg the whole nav collapses here. */}
        <Sheet>
          <SheetTrigger
            aria-label="Menu"
            render={<Button tone="sunken" scale="icon" />}
            className="lg:hidden"
          >
            <Menu className="size-4" />
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle>{brand.label}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-1 p-4">
              {allItems.map((item) => (
                <NavPill
                  key={item.href}
                  href={item.href}
                  target={item.external ? "_blank" : undefined}
                  active={isActive(item)}
                  scale="block"
                >
                  {item.icon && <item.icon className="size-4 shrink-0" />}
                  {item.label}
                </NavPill>
              ))}
            </div>
          </SheetContent>
        </Sheet>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label="Account" className="rounded-full">
              <Avatar className="size-11">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="bg-sunken text-sm font-semibold">
                  {initials(user.name || user.email || "")}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {(user.name || user.email) && (
                <>
                  {/* Base UI's label is a GroupLabel and throws outside a
                      Group -- unlike Radix, the wrapper isn't optional. */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="min-w-0">
                      <span className="block truncate">
                        {user.name || user.email}
                      </span>
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </>
              )}
              {onLogout && (
                <DropdownMenuItem onClick={onLogout}>Log out</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </nav>
  );
}
