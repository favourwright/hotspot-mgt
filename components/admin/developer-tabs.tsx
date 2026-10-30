"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { tenantBasePath } from "@/lib/tenant-url";

/** The pages behind the "Developers" menu entry, in the order it opens them. */
export const DEVELOPER_PAGES = [
  { label: "API keys", path: "api-keys" },
  { label: "Hooks", path: "hooks" },
  { label: "Webhooks", path: "webhooks" },
] as const;

/**
 * Moves between the developer pages. Links, not `system/tabs`, because each
 * is its own route; styled as that tab track so it reads as the same control.
 */
export function DeveloperTabs({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  const base = `${tenantBasePath(tenantSlug)}/admin`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav className="inline-flex h-9 w-full items-center rounded-full bg-raised p-1 sm:w-fit" aria-label="Developer pages">
        {DEVELOPER_PAGES.map((page) => {
          const href = `${base}/${page.path}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={page.path}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-full flex-1 items-center justify-center rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors",
                active ? "bg-sunken text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {page.label}
            </Link>
          );
        })}
      </nav>
      <a
        href="/developers"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground"
      >
        <BookOpen className="size-4" />
        API docs
      </a>
    </div>
  );
}
