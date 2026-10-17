import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";
import { PageHeader } from "@/components/system/page-header";
import { Button } from "@/components/system/button";
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { NavPill } from "@/components/system/nav-pill";
import { LegalBody } from "@/components/legal/legal-body";
import { type LegalDocument } from "@/lib/legal-data";
import { formatDay } from "@/lib/utils";

interface LegalPageProps {
  document: LegalDocument;
}

export function LegalPage({ document }: LegalPageProps) {
  return (
    <AppShell>
      <PageContent>
        <PageHeader
          title={document.title}
          description={document.description}
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

        <div className="grid items-start gap-6 lg:grid-cols-[16rem_1fr]">
          <nav className="hidden lg:sticky lg:top-6 lg:block">
            <SurfaceCard>
              <SurfaceCardHeader>
                <SurfaceCardTitle className="text-base">
                  Contents
                </SurfaceCardTitle>
              </SurfaceCardHeader>
              <SurfaceCardContent inset={false} className="flex flex-col gap-1">
                {document.sections.map((section) => (
                  <NavPill
                    key={section.id}
                    href={`#${section.id}`}
                    scale="block"
                  >
                    <span className="truncate">{section.title}</span>
                  </NavPill>
                ))}
              </SurfaceCardContent>
            </SurfaceCard>
          </nav>

          <div className="flex flex-col gap-6">
            {document.sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-6"
              >
                <SurfaceCard>
                  <SurfaceCardHeader>
                    <SurfaceCardTitle>{section.title}</SurfaceCardTitle>
                    <SurfaceCardDescription>
                      {section.description}
                    </SurfaceCardDescription>
                  </SurfaceCardHeader>
                  <SurfaceCardContent>
                    <LegalBody blocks={section.blocks} />
                  </SurfaceCardContent>
                </SurfaceCard>
              </section>
            ))}

            <p className="text-xs text-muted-foreground">
              Last updated {formatDay(document.updated)}
            </p>
          </div>
        </div>
      </PageContent>
    </AppShell>
  );
}
