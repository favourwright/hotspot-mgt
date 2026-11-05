"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"

import type {
  SweeperRouterReport,
  SweeperTenantReport,
} from "@/lib/expiry-sweeper-rollout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { toast } from "@/components/ui/toast"
import { auth } from "@/lib/firebase"

interface TenantRow {
  tenantId: string
  name: string
  slug: string | null
  routers: number
}

async function authedFetch(url: string, init?: RequestInit) {
  if (!auth?.currentUser) throw new Error("Not authenticated")
  const token = await auth.currentUser.getIdToken()
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  const json = await response.json()
  if (!json.success) throw new Error(json.error || "Request failed")
  return json.data
}

/** One line per router: what a dry run found, or what applying did. */
function routerSummary(router: SweeperRouterReport): string {
  if (!router.reachable) return `unreachable${router.error ? ` (${router.error})` : ""}`
  const parts: string[] = []
  const counts = new Map<string, number>()
  for (const p of router.profiles) counts.set(p.status, (counts.get(p.status) ?? 0) + 1)
  for (const [status, n] of counts) parts.push(`${n} ${status}`)
  if (router.legacy) {
    if (router.legacy.scheduler !== "absent" || router.legacy.script !== "absent") {
      parts.push(`legacy scheduler ${router.legacy.scheduler}, script ${router.legacy.script}`)
    } else {
      parts.push("no legacy checker")
    }
  }
  return parts.join(", ") || "no plans on this router"
}

function needsWork(report: SweeperTenantReport): boolean {
  return report.routers.some(
    (r) =>
      r.profiles.some((p) => p.status === "outdated") ||
      r.legacy?.scheduler === "would-remove" ||
      r.legacy?.script === "would-remove"
  )
}

/**
 * Router expiry sweeper rollout. Check is read-only; Apply re-pushes each
 * outdated per-profile sweeper and removes the legacy global checker.
 * Tenants run one at a time, each its own request.
 */
export function ExpirySweeperCard() {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null)
  const [reports, setReports] = useState<Record<string, SweeperTenantReport>>({})
  const [busy, setBusy] = useState<string | null>(null)

  async function loadTenants() {
    setBusy("load")
    try {
      setTenants(await authedFetch("/api/superadmin/expiry-sweeper"))
      setReports({})
    } catch (error) {
      toast.add({ title: error instanceof Error ? error.message : "Could not load tenants", type: "error" })
    } finally {
      setBusy(null)
    }
  }

  async function run(tenantIds: string[], apply: boolean) {
    for (const tenantId of tenantIds) {
      setBusy(tenantId)
      try {
        const report: SweeperTenantReport = await authedFetch(
          "/api/superadmin/expiry-sweeper",
          { method: "POST", body: JSON.stringify({ tenantId, apply }) }
        )
        setReports((prev) => ({ ...prev, [tenantId]: report }))
      } catch (error) {
        toast.add({ title: error instanceof Error ? error.message : "Rollout failed", type: "error" })
      }
    }
    setBusy(null)
  }

  const checkedNeedingWork = Object.values(reports)
    .filter((r) => !r.applied && needsWork(r))
    .map((r) => r.tenantId)

  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <SurfaceCardTitle>Router expiry sweeper</SurfaceCardTitle>
        <SurfaceCardDescription>
          Routers set up before 2026-09-24 still run the old global expiry
          checker, and every sweep re-wrote users that had already expired.
          Check reads each router and changes nothing. Apply updates outdated
          sweepers and removes the old checker, only where its contents match
          what this app installed.
        </SurfaceCardDescription>
      </SurfaceCardHeader>
      <SurfaceCardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadTenants} disabled={busy !== null}>
            {busy === "load" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load tenants
          </Button>
          {tenants && tenants.length > 0 && (
            <Button
              variant="outline"
              onClick={() => run(tenants.map((t) => t.tenantId), false)}
              disabled={busy !== null}
            >
              Check all
            </Button>
          )}
          {checkedNeedingWork.length > 0 && (
            <Button onClick={() => run(checkedNeedingWork, true)} disabled={busy !== null}>
              Apply to {checkedNeedingWork.length} tenant
              {checkedNeedingWork.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>

        {tenants && tenants.length === 0 && (
          <p className="text-sm text-muted-foreground">No tenant has an active router.</p>
        )}

        {tenants && tenants.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {tenants.map((tenant) => {
              const report = reports[tenant.tenantId]
              return (
                <li key={tenant.tenantId} className="space-y-1 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {tenant.name}
                      {tenant.slug && (
                        <span className="ml-2 text-muted-foreground">{tenant.slug}</span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {busy === tenant.tenantId && <Loader2 className="h-4 w-4 animate-spin" />}
                      {report && (
                        <Badge variant={report.applied ? "default" : needsWork(report) ? "destructive" : "secondary"}>
                          {report.applied ? "applied" : needsWork(report) ? "needs update" : "up to date"}
                        </Badge>
                      )}
                    </span>
                  </div>
                  {report?.routers.map((router) => (
                    <p key={router.routerId} className="text-xs text-muted-foreground">
                      {router.routerName}: {routerSummary(router)}
                    </p>
                  ))}
                </li>
              )
            })}
          </ul>
        )}
      </SurfaceCardContent>
    </SurfaceCard>
  )
}
