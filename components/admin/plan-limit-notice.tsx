import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  planLimitMessage,
  type PlanResourceLimit,
} from "@/lib/plan-resource-limits"
import { tenantHref } from "@/lib/tenant-url"

/**
 * Why the add button above it is greyed out. Shown up front because the
 * router wizard has an owner running commands on their router before the
 * server gets a chance to refuse.
 */
export function PlanLimitNotice({
  limit,
  allowed,
  planName,
  tenantSlug,
}: {
  limit: PlanResourceLimit
  allowed: number
  planName: string | null
  tenantSlug: string
}) {
  return (
    <Alert>
      <AlertDescription>
        <span>
          {planLimitMessage(limit, allowed, planName)}{" "}
          <Link
            href={tenantHref(tenantSlug, "/admin/settings")}
            className="underline underline-offset-2"
          >
            Open Settings
          </Link>
        </span>
      </AlertDescription>
    </Alert>
  )
}
