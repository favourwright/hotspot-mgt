export default function TenantAdminPage({
  params,
}: {
  params: { tenantSlug: string };
}) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>
      <p className="text-muted-foreground mt-1">Tenant: {params.tenantSlug}</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Full dashboard coming in the next step.
      </p>
    </div>
  );
}
