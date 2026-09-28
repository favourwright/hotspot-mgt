"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FaqItem } from "@/components/faq/faq-item";
import { FAQ_CATEGORIES } from "@/lib/faq-data";

export function FaqPageClient() {
  const [query, setQuery] = useState("");

  const filteredCategories = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQ_CATEGORIES;

    return FAQ_CATEGORIES.map((category) => ({
      ...category,
      entries: category.entries.filter((entry) =>
        entry.question.toLowerCase().includes(q)
      ),
    })).filter((category) => category.entries.length > 0);
  }, [query]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="font-heading text-3xl font-bold">Frequently Asked Questions</h1>
        <p className="mt-2 text-muted-foreground">
          Answers for customers buying vouchers and businesses running their portal.
        </p>
      </div>

      <div className="relative mb-8">
        <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions..."
          className="pl-9"
        />
      </div>

      {filteredCategories.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          No questions matched &quot;{query}&quot;.
        </p>
      ) : (
        <nav className="mb-10 flex flex-wrap justify-center gap-x-4 gap-y-2 text-sm">
          {filteredCategories.map((category) => (
            <a
              key={category.id}
              href={`#${category.id}`}
              className="text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
            >
              {category.title}
            </a>
          ))}
        </nav>
      )}

      <div className="space-y-12">
        {filteredCategories.map((category) => (
          <section key={category.id} id={category.id} className="scroll-mt-6">
            <h2 className="font-heading text-xl font-semibold">{category.title}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{category.description}</p>
            <div className="space-y-3">
              {category.entries.map((entry) => (
                <FaqItem key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
