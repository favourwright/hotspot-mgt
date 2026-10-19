import {
  SurfaceCard,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import { AppShell } from "@/components/system/app-shell";
import { PageContent } from "@/components/system/page-content";

/**
 * Shown when the tenant has no captive-portal entitlement.
 *
 * Deliberately says nothing about billing. The audience here is the venue's
 * wifi customers, not the venue, and telling a room full of strangers that
 * this business has not paid its bill would be a gratuitous humiliation on
 * top of an outage. The owner learns about it through the admin UI and
 * their email, where it belongs; the real reason is in the server log.
 *
 * Shared by both portal routes. The entitlement is re-checked on each of
 * them rather than inherited, because they are separate requests and a
 * portal that kept selling from its second page after the addon lapsed
 * would be a paywall with a hole in it.
 */
export function PortalUnavailable({ businessName }: { businessName: string }) {
  return (
    <AppShell>
      <PageContent width="prose" className="py-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {businessName}
          </h1>
        </div>

        <SurfaceCard>
          <SurfaceCardHeader>
            <SurfaceCardTitle>Sign-in is unavailable</SurfaceCardTitle>
            <SurfaceCardDescription>
              This network is not accepting new sign-ins at the moment. Please
              ask at the desk, and they will be able to help you get online.
            </SurfaceCardDescription>
          </SurfaceCardHeader>
        </SurfaceCard>
      </PageContent>
    </AppShell>
  );
}
