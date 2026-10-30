"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FileJson, LifeBuoy, Menu, Search, Wifi } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavGroup, SearchEntry } from "@/lib/docs-view";
import { MethodBadge } from "@/components/developers/method-badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/system/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/**
 * The /developers frame from the reference designs: a dark sidebar, a top
 * bar with search, and the content. One page; the sidebar jumps to sections
 * and highlights the one being read.
 *
 * Dark in both themes: `bg-foreground` (the theme's own dark) in light mode,
 * the raised `bg-card` in dark mode, so it stays a distinct column.
 */
export function DocsShell({
  brand,
  nav,
  search,
  supportEmail,
  children,
}: {
  brand: string;
  nav: NavGroup[];
  search: SearchEntry[];
  supportEmail: string;
  children: ReactNode;
}) {
  const [active, setActive] = useState("introduction");
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // The section being read: the topmost one inside the upper part of the
  // viewport. State changes only in the observer's callback.
  useEffect(() => {
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top);
          else visible.delete(e.target.id);
        }
        const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (top) setActive(top[0]);
      },
      { rootMargin: "-80px 0px -60% 0px" }
    );
    document.querySelectorAll("[data-doc-section]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // ⌘K / Ctrl+K anywhere, and "/" when not typing, as on most docs sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <SidebarNav
      brand={brand}
      nav={nav}
      active={active}
      onNavigate={() => setMenuOpen(false)}
    />
  );

  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-svh overflow-y-auto bg-foreground text-background lg:block dark:bg-card dark:text-card-foreground">
        {sidebar}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-8">
            <button
              type="button"
              className="grid size-10 place-items-center rounded-full hover:bg-muted lg:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open the docs menu"
            >
              <Menu className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-10 w-full max-w-sm items-center gap-2 rounded-full bg-muted px-4 text-sm text-muted-foreground transition-colors hover:bg-muted/80"
            >
              <Search className="size-4" />
              <span className="flex-1 text-left">Search...</span>
              <kbd className="hidden rounded-md bg-background px-1.5 py-0.5 font-mono text-xs sm:inline">⌘K</kbd>
            </button>
            <nav className="ml-auto flex items-center gap-1 text-sm">
              <a
                href="/api/v1/openapi.json"
                className="hidden items-center gap-1.5 rounded-full px-3 py-2 hover:bg-muted sm:flex"
              >
                <FileJson className="size-4" />
                openapi.json
              </a>
              <a href={`mailto:${supportEmail}`} className="flex items-center gap-1.5 rounded-full px-3 py-2 hover:bg-muted">
                <LifeBuoy className="size-4" />
                Support
              </a>
            </nav>
          </div>
        </header>

        <main>{children}</main>
      </div>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-72 bg-foreground p-0 text-background dark:bg-card dark:text-card-foreground">
          <SheetTitle className="sr-only">Docs menu</SheetTitle>
          <div className="h-full overflow-y-auto">{sidebar}</div>
        </SheetContent>
      </Sheet>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} entries={search} />
    </div>
  );
}

function SidebarNav({
  brand,
  nav,
  active,
  onNavigate,
}: {
  brand: string;
  nav: NavGroup[];
  active: string;
  onNavigate: () => void;
}) {
  // Consecutive groups with the same title (the endpoint resources) share
  // one heading, each as its own collapsible sub-group.
  const sections: { title: string; groups: NavGroup[] }[] = [];
  for (const g of nav) {
    const last = sections[sections.length - 1];
    if (last && last.title === g.title) last.groups.push(g);
    else sections.push({ title: g.title, groups: [g] });
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-5">
      <a href="#introduction" onClick={onNavigate} className="flex items-center gap-3 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-background text-foreground dark:bg-foreground dark:text-background">
          <Wifi className="size-4" />
        </span>
        <span className="font-semibold">{brand}</span>
        <span className="ml-auto font-mono text-xs opacity-50">v1</span>
      </a>

      {sections.map((section) => (
        <div key={section.title} className="space-y-1.5">
          <p className="px-2 font-mono text-[0.65rem] tracking-[0.18em] uppercase opacity-50">{section.title}</p>
          {section.groups.map((g) =>
            g.sub ? (
              <SubGroup key={g.sub} group={g} active={active} onNavigate={onNavigate} />
            ) : (
              <ul key={g.title} className="space-y-0.5">
                {g.items.map((item) => (
                  <NavLink key={item.id} item={item} active={active === item.id} onNavigate={onNavigate} />
                ))}
              </ul>
            )
          )}
        </div>
      ))}
    </div>
  );
}

function SubGroup({ group, active, onNavigate }: { group: NavGroup; active: string; onNavigate: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium hover:bg-background/10 dark:hover:bg-muted"
        aria-expanded={open}
      >
        {group.sub}
        <ChevronDown className={cn("size-3.5 opacity-60 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5 pl-2">
          {group.items.map((item) => (
            <NavLink key={item.id} item={item} active={active === item.id} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NavLink({ item, active, onNavigate }: { item: NavGroup["items"][number]; active: boolean; onNavigate: () => void }) {
  return (
    <li>
      <a
        href={`#${item.id}`}
        onClick={onNavigate}
        aria-current={active ? "location" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm transition-colors",
          active
            ? "bg-background/12 font-medium dark:bg-muted"
            : "opacity-75 hover:bg-background/8 hover:opacity-100 dark:hover:bg-muted/60"
        )}
      >
        {item.badge && <MethodBadge method={item.badge} size="sm" onDark />}
        <span className="truncate">{item.label}</span>
      </a>
    </li>
  );
}

function SearchDialog({
  open,
  onOpenChange,
  entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: SearchEntry[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return entries.slice(0, 8);
    return entries
      .filter((e) => words.every((w) => e.text.includes(w)))
      .sort((a, b) => Number(b.title.toLowerCase().includes(words[0])) - Number(a.title.toLowerCase().includes(words[0])))
      .slice(0, 12);
  }, [query, entries]);

  const go = (id: string) => {
    onOpenChange(false);
    setQuery("");
    window.location.hash = id;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQuery("");
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search the docs</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border/60 px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelected((s) => Math.min(s + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && results[selected]) {
                go(results[selected].id);
              }
            }}
            placeholder="Search endpoints, events, fields..."
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches &ldquo;{query}&rdquo;.</li>
          ) : (
            results.map((r, i) => (
              <li key={r.id}>
                <button
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => go(r.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm",
                    i === selected && "bg-muted"
                  )}
                >
                  {r.badge ? <MethodBadge method={r.badge} size="sm" /> : <span className="w-9" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{r.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
