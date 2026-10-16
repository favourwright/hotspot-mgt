"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Tenant } from "@/types/schemas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/system/button"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import { PageHeader } from "@/components/system/page-header"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import { toast } from "@/components/ui/toast"
import {
  Building2,
  ChevronDown,
  ExternalLink,
  MoreHorizontal,
  Search,
  Wallet,
} from "lucide-react"
import { auth } from "@/lib/firebase"
import { tenantUrl } from "@/lib/tenant-url";
import { formatDay } from "@/lib/utils"
import { TenantBillingDialog } from "./tenant-billing-dialog"

interface TenantsClientProps {
  initialTenants: Tenant[]
}

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "pending", label: "Pending" },
] as const

export function TenantsClient({ initialTenants }: TenantsClientProps) {
  const router = useRouter()
  const [tenants, setTenants] = useState(initialTenants)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [billingTenantId, setBillingTenantId] = useState<string | null>(null)

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default"
      case "suspended":
        return "destructive"
      case "pending":
        return "secondary"
      default:
        return "secondary"
    }
  }

  const filteredTenants = tenants.filter((tenant) => {
    const matchesSearch =
      tenant.businessName.toLowerCase().includes(search.toLowerCase()) ||
      tenant.slug.toLowerCase().includes(search.toLowerCase()) ||
      tenant.ownerEmail.toLowerCase().includes(search.toLowerCase())
    const matchesStatus =
      statusFilter === "all" || tenant.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const updateTenantStatus = async (
    tenantId: string,
    status: "active" | "suspended"
  ) => {
    setLoadingId(tenantId)
    try {
      if (!auth?.currentUser) throw new Error("Not authenticated")
      const token = await auth.currentUser.getIdToken()

      const response = await fetch(`/api/superadmin/tenants/${tenantId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      })

      const data = await response.json()
      if (!data.success) throw new Error(data.error)

      setTenants((prev) =>
        prev.map((t) => (t.id === tenantId ? { ...t, status } : t))
      )

      toast.add({
        title: status === "suspended" ? "Tenant suspended" : "Tenant activated",
        description:
          status === "suspended"
            ? "Tenant portal is now inaccessible"
            : "Tenant portal is now active",
        type: "success",
      })

      router.refresh()
    } catch (err) {
      toast.add({
        title: "Failed to update tenant",
        description: err instanceof Error ? err.message : "Unknown error",
        type: "error",
      })
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenants"
        description="Manage all platform tenants"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name, slug or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button tone="raised" scale="sm" />}
                className="w-40 shrink-0 justify-between"
              >
                {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ??
                  "All status"}
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuRadioGroup
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value || "all")}
                >
                  {STATUS_OPTIONS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <SurfaceCard>
        <SurfaceCardHeader>
          <SurfaceCardTitle>All tenants</SurfaceCardTitle>
          <SurfaceCardDescription>
            {tenants.length} {tenants.length === 1 ? "tenant" : "tenants"}
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {filteredTenants.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>No tenants found</EmptyTitle>
                <EmptyDescription>
                  No tenants match your current search or filter.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Joined</TableHead>
                  <TableHead>Business</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Billing Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTenants.map((tenant) => (
                  <TableRow key={tenant.id}>
                    <TableCell className="text-sm text-muted-foreground">
                      {tenant.createdAt instanceof Date
                        ? formatDay(tenant.createdAt)
                        : formatDay(new Date(tenant.createdAt))}
                    </TableCell>
                    <TableCell className="font-medium">
                      {tenant.businessName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {tenant.ownerEmail}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      /{tenant.slug}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {tenant.planName}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(tenant.status)}>
                        {tenant.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8"
                              disabled={loadingId === tenant.id}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <Link href={tenantUrl(tenant.slug, "/admin")} target="_blank">
                            <DropdownMenuItem>
                              <ExternalLink className="mr-2 h-4 w-4" />
                              View Dashboard
                            </DropdownMenuItem>
                          </Link>
                          <DropdownMenuItem
                            onClick={() => setBillingTenantId(tenant.id)}
                          >
                            <Wallet className="mr-2 h-4 w-4" />
                            Manage Billing
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {tenant.status === "active" ? (
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() =>
                                updateTenantStatus(tenant.id, "suspended")
                              }
                            >
                              Suspend Tenant
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                updateTenantStatus(tenant.id, "active")
                              }
                            >
                              Activate Tenant
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>

      <TenantBillingDialog
        open={billingTenantId !== null}
        onOpenChange={(open) => !open && setBillingTenantId(null)}
        tenantId={billingTenantId}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}
