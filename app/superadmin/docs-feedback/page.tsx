import Link from "next/link";
import { MessageSquareText } from "lucide-react";

import { requireSuperAdmin } from "@/lib/server-auth";
import { docsSectionIds, listDocsFeedback } from "@/lib/docs-feedback";
import { PageHeader } from "@/components/system/page-header";
import { SurfaceCard, SurfaceCardContent } from "@/components/system/surface-card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/system/empty-state";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The "Was this helpful?" counts from /developers, per section. Sorted by
 * the most "no" answers, so the sections that need rewriting come first.
 */
export default async function SuperAdminDocsFeedbackPage() {
  await requireSuperAdmin();
  const known = docsSectionIds();
  const rows = await listDocsFeedback();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Docs feedback"
        description="What developers answered to &quot;Was this helpful?&quot; under each section of /developers. The sections with the most no answers are at the top."
      />

      {rows.length === 0 ? (
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareText />
                </EmptyMedia>
                <EmptyTitle>No answers yet</EmptyTitle>
                <EmptyDescription>
                  Counts appear here once someone answers under a section of the developer docs.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <SurfaceCardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-3 font-medium">Section</th>
                  <th className="pb-3 text-right font-medium">Yes</th>
                  <th className="pb-3 text-right font-medium">No</th>
                  <th className="pb-3 text-right font-medium">Helpful</th>
                  <th className="pb-3 text-right font-medium">Last answer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const total = r.yes + r.no;
                  // A section renamed or removed since keeps its counts but no link.
                  const live = known.has(r.id);
                  return (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="py-3">
                        {live ? (
                          <Link href={`/developers#${r.id}`} className="font-medium hover:underline">
                            {r.title}
                          </Link>
                        ) : (
                          <span className="font-medium text-muted-foreground">{r.title}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">{r.group}</span>
                      </td>
                      <td className="py-3 text-right tabular-nums">{r.yes}</td>
                      <td className="py-3 text-right tabular-nums">{r.no}</td>
                      <td className="py-3 text-right tabular-nums">
                        {total ? `${Math.round((r.yes / total) * 100)}%` : "-"}
                      </td>
                      <td className="py-3 text-right text-muted-foreground">
                        {r.updatedAt ? formatDate(r.updatedAt) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </SurfaceCardContent>
        </SurfaceCard>
      )}
    </div>
  );
}
