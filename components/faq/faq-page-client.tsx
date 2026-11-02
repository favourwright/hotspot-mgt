"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircleQuestion } from "lucide-react";

import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { PageHeader } from "@/components/system/page-header";
import { Toolbar, SearchField } from "@/components/system/toolbar";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/system/accordion";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { NavPill } from "@/components/system/nav-pill";
import { FaqAnswer } from "@/components/faq/faq-answer";
import { FAQ_CATEGORIES, faqBlockText } from "@/lib/faq-data";

export function FaqPageClient() {
  const [query, setQuery] = useState("");

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_CATEGORIES;

    return FAQ_CATEGORIES.map((category) => ({
      ...category,
      entries: category.entries.filter((entry) => {
        const haystack = [
          entry.question,
          ...entry.answer.map(faqBlockText),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(q);
      }),
    })).filter((category) => category.entries.length > 0);
  }, [query]);

  const total = filteredCategories.reduce(
    (sum, category) => sum + category.entries.length,
    0
  );

  return (
    <AppShell>
      <PageContent>
        <PageHeader
          title="Questions, answered"
          description="For customers buying vouchers, and for businesses running their own portal."
          action={
            <Button
              tone="raised"
              nativeButton={false}
              render={<Link href="/" />}
            >
              <ArrowLeft />
              Back to site
            </Button>
          }
        />

        <Toolbar
          end={
            <SearchField
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions and answers"
            />
          }
        >
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? "question" : "questions"}
          </span>
        </Toolbar>

        {filteredCategories.length === 0 ? (
          <SurfaceCard>
            <SurfaceCardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <MessageCircleQuestion />
                  </EmptyMedia>
                  <EmptyTitle>Nothing matched “{query}”</EmptyTitle>
                  <EmptyDescription>
                    Try a shorter phrase, or browse the categories instead.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </SurfaceCardContent>
          </SurfaceCard>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
            {/* Contents. Sticky on wide screens so the list stays reachable
                while reading a long category. */}
            <nav className="hidden lg:sticky lg:top-6 lg:block">
              <SurfaceCard>
                <SurfaceCardHeader>
                  <SurfaceCardTitle className="text-base">
                    Contents
                  </SurfaceCardTitle>
                </SurfaceCardHeader>
                <SurfaceCardContent inset={false} className="flex flex-col gap-1">
                  {filteredCategories.map((category) => (
                    <NavPill
                      key={category.id}
                      href={`#${category.id}`}
                      scale="block"
                      className="justify-between"
                    >
                      <span className="truncate">{category.title}</span>
                      <span className="shrink-0 text-xs opacity-60">
                        {category.entries.length}
                      </span>
                    </NavPill>
                  ))}
                </SurfaceCardContent>
              </SurfaceCard>
            </nav>

            <div className="flex flex-col gap-6">
              {filteredCategories.map((category) => (
                <section
                  key={category.id}
                  id={category.id}
                  className="scroll-mt-6"
                >
                  <SurfaceCard>
                    <SurfaceCardHeader>
                      <SurfaceCardTitle>{category.title}</SurfaceCardTitle>
                      <SurfaceCardDescription>
                        {category.description}
                      </SurfaceCardDescription>
                    </SurfaceCardHeader>
                    <SurfaceCardContent>
                      <Accordion multiple={false}>
                        {category.entries.map((entry) => (
                          <AccordionItem key={entry.id} value={entry.id}>
                            <AccordionTrigger className="hover:bg-muted-foreground/5">
                              {entry.question}
                            </AccordionTrigger>
                            <AccordionContent>
                              <FaqAnswer blocks={entry.answer} />
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </SurfaceCardContent>
                  </SurfaceCard>
                </section>
              ))}
            </div>
          </div>
        )}
      </PageContent>
    </AppShell>
  );
}
