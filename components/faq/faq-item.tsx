"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FaqAnswer } from "@/components/faq/faq-answer";
import { FaqEntry } from "@/lib/faq-data";
import { cn } from "@/lib/utils";

export function FaqItem({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="overflow-hidden py-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
      >
        <span className="font-medium">{entry.question}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180 text-primary"
          )}
        />
      </button>
      {open && (
        <div className="border-t px-4 py-4">
          <FaqAnswer blocks={entry.answer} />
        </div>
      )}
    </Card>
  );
}
