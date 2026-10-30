import { DeveloperTabs } from "@/components/admin/developer-tabs";

/**
 * Hooks, API keys and webhooks share one "Developers" menu entry, since most
 * tenants never use them. The route group keeps their URLs as they were:
 * emails link straight to /admin/hooks and /admin/webhooks.
 */
export default async function DevelopersLayout({ children, params }: LayoutProps<"/[tenantSlug]/admin">) {
  const { tenantSlug } = await params;
  return (
    <div className="space-y-6">
      <DeveloperTabs tenantSlug={tenantSlug} />
      {children}
    </div>
  );
}
