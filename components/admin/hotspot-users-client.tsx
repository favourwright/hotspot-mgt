"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { ExpiryRangePicker } from "@/components/admin/expiry-range-picker"
import { HotspotUserDialog } from "@/components/admin/hotspot-user-dialog"
import { Button } from "@/components/system/button"
import { PageHeader } from "@/components/system/page-header"
import { ErrorState } from "@/components/system/error-state"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/system/tabs"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/system/dialog"
import { Button as BaseButton } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { ApiError } from "@/lib/api-client"
import { toast } from "@/components/ui/toast"
import {
  AlertTriangle,
  ChevronDown,
  Eye,
  RefreshCw,
  Search,
  TriangleAlert,
  CircleMinus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react"
import { useHotspotUsers } from "@/hooks/use-hotspot-users"
import {
  useActiveSessions,
  useDisconnectSession,
} from "@/hooks/use-active-sessions"
import { LiveToggle, useLivePreference } from "@/components/admin/live-toggle"
import type { MergedHotspotUser, UserStatus } from "@/lib/hotspot-users"
import type { ActiveSession } from "@/lib/mikrotik"

interface HotspotUsersClientProps {
  locations: { id: string; name: string }[]
}

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "disabled", label: "Disabled" },
  { value: "missing-on-router", label: "Not on router" },
]

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  expired: "Expired",
  disabled: "Disabled",
  "missing-on-router": "Not on router",
}

const STATUS_VARIANT: Record<
  UserStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  expired: "secondary",
  disabled: "outline",
  "missing-on-router": "destructive",
}

/** Tracks whether this tab is in the foreground, for the Live indicator. */
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible")
    onChange()
    document.addEventListener("visibilitychange", onChange)
    return () => document.removeEventListener("visibilitychange", onChange)
  }, [])
  return visible
}

function formatBytes(value: string | undefined): string {
  const bytes = Number(value ?? 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return "-"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/**
 * MikroTik reports consumed uptime as "0s" (or omits it) before a user has
 * ever connected.
 */
function hasStartedClocking(uptime: string | null): boolean {
  if (!uptime) return false
  return !/^0+s?$/.test(uptime.trim())
}

/**
 * What the Expires column says, which depends on how the plan is enforced.
 *
 * A router-created user has a calendar date in its comment. A
 * platform-sold voucher does not: its plan is a *usage* allowance applied
 * by the MikroTik profile, which only begins counting at first login. For
 * those, a blank cell read as missing data when it actually meant "this
 * hasn't started yet", so say that instead.
 */
function ExpiryCell({ user }: { user: MergedHotspotUser }) {
  if (user.expiresAt) {
    return <>{formatDate(user.expiresAt)}</>
  }

  if (user.platformManaged) {
    if (!hasStartedClocking(user.uptimeUsed)) {
      return (
        <span className="flex flex-col">
          <span>Not started</span>
          <span className="text-xs text-muted-foreground">
            Begins at first login
          </span>
        </span>
      )
    }

    const unlimited = !user.limitUptime || /^0+s?$/.test(user.limitUptime)
    return (
      <span className="flex flex-col">
        <span>{user.uptimeUsed} used</span>
        {!unlimited && (
          <span className="text-xs text-muted-foreground">
            of {user.limitUptime}
          </span>
        )}
      </span>
    )
  }

  return <>-</>
}

function formatDate(iso: string | null): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function HotspotUsersClient({ locations }: HotspotUsersClientProps) {
  const searchParams = useSearchParams()

  // Filters live in the URL so a reload, a shared link, or coming back from
  // another page lands on the same view. Initialised once from the query
  // string; the effect below writes changes back.
  const [locationId, setLocationId] = useState<string | null>(() => {
    const requested = searchParams.get("location")
    if (requested && locations.some((l) => l.id === requested)) return requested
    return locations[0]?.id ?? null
  })
  const [tab, setTab] = useState(() =>
    searchParams.get("tab") === "active" ? "active" : "users"
  )
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("q") ?? "")
  const [statusFilter, setStatusFilter] = useState(
    () => searchParams.get("status") ?? "all"
  )
  const [expiresFrom, setExpiresFrom] = useState(
    () => searchParams.get("from") ?? ""
  )
  const [expiresTo, setExpiresTo] = useState(() => searchParams.get("to") ?? "")
  const [detailUsername, setDetailUsername] = useState<string | null>(null)
  const [disconnectMode, setDisconnectMode] = useState(false)
  const [sessionToDisconnect, setSessionToDisconnect] =
    useState<ActiveSession | null>(null)
  const [live, setLive] = useLivePreference(true)
  const tabVisible = useTabVisible()

  const users = useHotspotUsers(locationId)
  const sessions = useActiveSessions(locationId, live && tab === "active")
  const disconnect = useDisconnectSession(locationId)

  // Native history.replaceState rather than router.replace: the latter is a
  // navigation, so every keystroke would re-run this route's server
  // component (auth + the locations query) for a change the client already
  // rendered. Next integrates these calls with useSearchParams.
  useEffect(() => {
    const params = new URLSearchParams()
    if (tab !== "users") params.set("tab", tab)
    if (locationId) params.set("location", locationId)
    if (searchTerm) params.set("q", searchTerm)
    if (statusFilter !== "all") params.set("status", statusFilter)
    if (expiresFrom) params.set("from", expiresFrom)
    if (expiresTo) params.set("to", expiresTo)

    const query = params.toString()
    window.history.replaceState(
      null,
      "",
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    )
  }, [tab, locationId, searchTerm, statusFilter, expiresFrom, expiresTo])

  const data = users.data
  const sessionData = sessions.data

  const filteredUsers = useMemo(() => {
    let filtered = data?.users ?? []

    if (statusFilter !== "all") {
      filtered = filtered.filter((u) => u.status === statusFilter)
    }

    if (searchTerm) {
      const needle = searchTerm.toLowerCase()
      filtered = filtered.filter(
        (u) =>
          u.username.toLowerCase().includes(needle) ||
          u.customerEmail?.toLowerCase().includes(needle) ||
          u.planName?.toLowerCase().includes(needle) ||
          u.profile?.toLowerCase().includes(needle)
      )
    }

    // The range is on expiry, which is the date this page exists to watch.
    // Rows with no expiry at all -- a platform voucher that hasn't started
    // -- can't satisfy a range, so they drop out while one is set. The
    // table says so rather than letting them vanish unexplained.
    if (expiresFrom || expiresTo) {
      const start = expiresFrom ? new Date(`${expiresFrom}T00:00:00`) : null
      const end = expiresTo ? new Date(`${expiresTo}T23:59:59.999`) : null

      filtered = filtered.filter((u) => {
        if (!u.expiresAt) return false
        const expiry = new Date(u.expiresAt)
        if (start && expiry < start) return false
        if (end && expiry > end) return false
        return true
      })
    }

    return filtered
  }, [data?.users, searchTerm, statusFilter, expiresFrom, expiresTo])

  const hasDateRange = Boolean(expiresFrom || expiresTo)
  const isFiltered =
    statusFilter !== "all" || searchTerm.length > 0 || hasDateRange

  const liveState = !live
    ? ("off" as const)
    : sessions.gaveUp || sessionData?.reachable === false
      ? ("failing" as const)
      : !tabVisible
        ? ("paused-hidden" as const)
        : ("polling" as const)

  // Disconnect mode does not outlive the view it was switched on in, so
  // nobody returns to a table quietly offering a destructive control they
  // don't remember enabling, and a pending confirmation can't survive to
  // ask about a session belonging to a location that is no longer shown.
  // Done from the two handlers that move the view rather than from an
  // effect watching them: an effect that only calls setState is a second
  // render pass to reach a state this already knows at the event.
  const leaveDisconnectMode = () => {
    setDisconnectMode(false)
    setSessionToDisconnect(null)
  }

  const handleDisconnect = async () => {
    const target = sessionToDisconnect
    if (!target) return

    try {
      await disconnect.mutateAsync({ id: target[".id"], user: target.user })
      toast.add({
        title: "Device disconnected",
        description: `${target.user} was dropped from that session. The voucher still works, so they can log back in.`,
        type: "success",
      })
    } catch (error) {
      // 409 is the server saying the session ended on its own between the
      // last poll and this click. That is the state the operator wanted, so
      // it is information rather than a failure.
      const ended = (error as ApiError).status === 409
      toast.add({
        title: ended
          ? "That session had already ended"
          : "Couldn't disconnect this device",
        description: error instanceof Error ? error.message : "Unknown error",
        type: ended ? "info" : "error",
      })
    } finally {
      setSessionToDisconnect(null)
    }
  }

  // Below every hook, deliberately. This used to sit above the
  // history.replaceState effect and the filtering memo, which made the
  // number of hooks this component runs depend on whether the tenant has
  // any locations - the one thing React does not allow. It survived only
  // because `locations` is a server-rendered prop that cannot change
  // within a mount; anything that later made it change would have thrown
  // "rendered more hooks than during the previous render" here.
  if (locations.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Users"
          description="Hotspot users across your locations"
        />
        <SurfaceCard>
          <SurfaceCardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>No locations yet</EmptyTitle>
                <EmptyDescription>
                  Add a location and connect a router to see its hotspot users
                  here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </SurfaceCardContent>
        </SurfaceCard>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Everyone on your hotspot - sold through the platform or created on the router"
        action={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button tone="raised" />}
              className="w-[200px] justify-between"
            >
              <span className="truncate">
                {locations.find((loc) => loc.id === locationId)?.name ||
                  "Select location"}
              </span>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuRadioGroup
                value={locationId ?? ""}
                onValueChange={(value) => {
                  if (!value) return
                  setLocationId(value)
                  leaveDisconnectMode()
                }}
              >
                {locations.map((location) => (
                  <DropdownMenuRadioItem key={location.id} value={location.id}>
                    {location.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value as string)
          leaveDisconnectMode()
        }}
      >
        {/* Tabs and the live controls share one row: both act on the same
            table, and the toggle only appears for the tab it actually
            drives, so it never implies control over the Users list.
            
            Stacked and reversed on phones, so the live controls sit above
            the tabs rather than below them -- the tab track is full width
            there, and anything underneath it reads as belonging to the
            panel it's sitting on top of. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <TabsList className="sm:w-fit flex-none">
            <TabsTrigger value="users">
              Users
              {data
                ? isFiltered
                  ? ` (${filteredUsers.length} of ${data.counts.total})`
                  : ` (${data.counts.total})`
                : ""}
            </TabsTrigger>
            <TabsTrigger value="active">
              Active now{sessionData ? ` (${sessionData.sessions.length})` : ""}
            </TabsTrigger>
          </TabsList>

          {tab === "users" && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-64">
                <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by username, email, plan..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
              <ExpiryRangePicker
                from={expiresFrom}
                to={expiresTo}
                onChange={(from, to) => {
                  setExpiresFrom(from)
                  setExpiresTo(to)
                }}
              />

              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button tone="raised" scale="sm" />}
                  className="w-40 shrink-0 justify-between"
                >
                  {STATUS_FILTERS.find((o) => o.value === statusFilter)?.label ??
                    "All status"}
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuRadioGroup
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value || "all")}
                  >
                    {STATUS_FILTERS.map((option) => (
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
          )}

          {tab === "active" && (
            <LiveToggle
              live={live}
              onChange={setLive}
              state={liveState}
              lastUpdated={sessionData?.fetchedAt ?? null}
              isFetching={sessions.isFetching}
              onRefresh={sessions.resume}
            />
          )}
        </div>

        <TabsContent value="users" className="mt-4">
          {users.isLoading ? (
            <TableSkeleton />
          ) : users.isError ? (
            <SurfaceCard>
              <SurfaceCardContent>
                <ErrorState
                  icon={<TriangleAlert />}
                  title="Couldn't load users"
                  description="Something went wrong fetching this location's hotspot users."
                  action={
                    <Button tone="action" onClick={() => users.refetch()}>
                      <RefreshCw />
                      Try again
                    </Button>
                  }
                />
              </SurfaceCardContent>
            </SurfaceCard>
          ) : data ? (
            <div className="flex flex-col gap-4">
              {!data.routerReachable && (
                <Alert>
                  <WifiOff className="size-4" />
                  <AlertDescription>
                    Couldn&apos;t reach {data.routerName} ({data.routerError}).
                    Showing what the platform sold - users created directly on
                    the router aren&apos;t included, and statuses may be out of
                    date.
                  </AlertDescription>
                </Alert>
              )}

              {data.counts.needsAttention > 0 && (
                <Alert>
                  <AlertTriangle className="size-4" />
                  <AlertDescription>
                    {data.counts.needsAttention}{" "}
                    {data.counts.needsAttention === 1
                      ? "user needs"
                      : "users need"}{" "}
                    attention - the platform and the router disagree about them.
                  </AlertDescription>
                </Alert>
              )}

              <SurfaceCard>
                <SurfaceCardHeader>
                  <SurfaceCardTitle>Hotspot users</SurfaceCardTitle>
                  <SurfaceCardDescription>
                    {data.counts.total}{" "}
                    {data.counts.total === 1 ? "user" : "users"} on{" "}
                    {data.routerName}
                  </SurfaceCardDescription>
                </SurfaceCardHeader>
                {/* `inset={false}`: a table runs to the card's edges -- the
                    sunken panel is for blocks, not rows. */}
                <SurfaceCardContent inset={false}>
                  {data.users.length === 0 ? (
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <Users />
                        </EmptyMedia>
                        <EmptyTitle>No hotspot users yet</EmptyTitle>
                        <EmptyDescription>
                          Users appear here once vouchers are sold or created on
                          the router.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <>
                      {hasDateRange && (
                        <p className="px-4 pb-2 text-xs text-muted-foreground">
                          Users with no expiry date are hidden while a date
                          range is set.
                        </p>
                      )}
                      <UsersTable
                        users={filteredUsers}
                        isFiltered={isFiltered}
                        onInspect={setDetailUsername}
                      />
                    </>
                  )}
                </SurfaceCardContent>
              </SurfaceCard>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          {sessions.isLoading ? (
            <TableSkeleton />
          ) : sessions.isError ? (
            // The route answers 200 even when the router is unreachable, so
            // reaching here means the request itself failed -- our API, the
            // network, the session. Distinct from `!reachable` below, and
            // previously it rendered nothing at all.
            <SurfaceCard>
              <SurfaceCardContent>
                <ErrorState
                  icon={<TriangleAlert />}
                  title="Couldn't load active sessions"
                  description="Something went wrong reaching the platform. Check your connection and try again."
                  action={
                    <Button tone="action" onClick={() => sessions.refetch()}>
                      <RefreshCw />
                      Try again
                    </Button>
                  }
                />
              </SurfaceCardContent>
            </SurfaceCard>
          ) : sessionData && !sessionData.reachable ? (
            <SurfaceCard>
              <SurfaceCardContent>
                <ErrorState
                  icon={<WifiOff />}
                  title={`Can't reach ${sessionData.routerName}`}
                  description={
                    <>
                      {sessionData.error}
                      {sessions.gaveUp
                        ? " We've stopped retrying for now."
                        : " Still retrying..."}
                    </>
                  }
                  action={
                    sessions.gaveUp ? (
                      <Button tone="action" onClick={sessions.resume}>
                        <RefreshCw />
                        Try again
                      </Button>
                    ) : undefined
                  }
                />
              </SurfaceCardContent>
            </SurfaceCard>
          ) : sessionData ? (
            <SurfaceCard
              action={
                // Only offered when there is something to disconnect, and
                // the same label-wraps-switch shape the Live control uses,
                // so the two read as one family of card controls.
                sessionData.sessions.length > 0 ? (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Disconnect mode
                    </span>
                    <Switch
                      checked={disconnectMode}
                      onCheckedChange={setDisconnectMode}
                      aria-label="Disconnect mode"
                    />
                  </label>
                ) : undefined
              }
            >
              <SurfaceCardHeader>
                <SurfaceCardTitle>Active now</SurfaceCardTitle>
                {/* Placed by hand: the action slot turns this header into a
                    two-column grid, and an auto-placed description lands in
                    the action's column, beside the title instead of under
                    it. */}
                <SurfaceCardDescription className="col-start-1 row-start-2">
                  {sessionData.sessions.length}{" "}
                  {sessionData.sessions.length === 1 ? "device" : "devices"}{" "}
                  connected to {sessionData.routerName}
                </SurfaceCardDescription>
              </SurfaceCardHeader>
              <SurfaceCardContent inset={false}>
                {sessionData.sessions.length === 0 ? (
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <Wifi />
                      </EmptyMedia>
                      <EmptyTitle>Nobody connected right now</EmptyTitle>
                      <EmptyDescription>
                        Active sessions appear here as people log in.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <SessionsTable
                    sessions={sessionData.sessions}
                    disconnectMode={disconnectMode}
                    onDisconnect={setSessionToDisconnect}
                  />
                )}
              </SurfaceCardContent>
            </SurfaceCard>
          ) : null}
        </TabsContent>
      </Tabs>

      <HotspotUserDialog
        locationId={locationId}
        username={detailUsername}
        open={detailUsername !== null}
        onOpenChange={(next) => {
          if (!next) setDetailUsername(null)
        }}
      />

      {/* A plain dialog rather than an alert dialog: this confirmation is
          reversible - the voucher still works and they can log straight
          back in - so clicking the scrim to back out should just work. */}
      <Dialog
        open={sessionToDisconnect !== null}
        onOpenChange={(next) => {
          // Ignored while the request is in flight, so the scrim and Escape
          // cannot close the dialog out from under a pending disconnect.
          if (!next && !disconnect.isPending) setSessionToDisconnect(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Disconnect {sessionToDisconnect?.user} from this session?
            </DialogTitle>
            <DialogDescription>
              The device at {sessionToDisconnect?.address} drops off the
              hotspot straight away.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <BaseButton variant="outline" disabled={disconnect.isPending} />
              }
            >
              Cancel
            </DialogClose>
            <BaseButton
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? "Disconnecting..." : "Disconnect device"}
            </BaseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function UsersTable({
  users,
  isFiltered,
  onInspect,
}: {
  users: MergedHotspotUser[]
  isFiltered: boolean
  onInspect: (username: string) => void
}) {
  // The caller handles "this location has no users at all"; reaching here
  // with nothing means the search or status filter excluded them, which is
  // a different thing to say.
  if (users.length === 0 && isFiltered) {
    return (
      <div className="p-8 text-center text-sm text-muted-foreground">
        No users match this search or filter.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Username</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Profile</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">View details</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.username}>
            <TableCell className="font-medium">
              {user.username}
              {user.drift && (
                <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="size-3 shrink-0" />
                  {user.drift}
                </span>
              )}
            </TableCell>
            <TableCell>
              <Badge
                variant={user.source === "platform" ? "secondary" : "outline"}
              >
                {user.source === "platform" ? "Platform" : "Router"}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[user.status]}>
                {STATUS_LABEL[user.status]}
              </Badge>
            </TableCell>
            <TableCell>{user.planName ?? "-"}</TableCell>
            <TableCell>{user.profile ?? "-"}</TableCell>
            <TableCell>
              <ExpiryCell user={user} />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {user.customerEmail ?? "-"}
            </TableCell>
            <TableCell className="text-right">
              <Button
                tone="ghost"
                scale="sm"
                onClick={() => onInspect(user.username)}
                aria-label={`View details for ${user.username}`}
              >
                <Eye />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SessionsTable({
  sessions,
  disconnectMode,
  onDisconnect,
}: {
  sessions: ActiveSession[]
  disconnectMode: boolean
  onDisconnect: (session: ActiveSession) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {disconnectMode && (
            <TableHead className="w-12">
              <span className="sr-only">Disconnect</span>
            </TableHead>
          )}
          <TableHead>User</TableHead>
          <TableHead>IP address</TableHead>
          <TableHead>MAC</TableHead>
          <TableHead>Uptime</TableHead>
          <TableHead>Downloaded</TableHead>
          <TableHead>Uploaded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session[".id"]}>
            {disconnectMode && (
              <TableCell>
                <Button
                  tone="ghost"
                  scale="sm"
                  onClick={() => onDisconnect(session)}
                  aria-label={`Disconnect ${session.user} from this session`}
                >
                  <CircleMinus className="text-destructive" />
                </Button>
              </TableCell>
            )}
            <TableCell className="font-medium">{session.user}</TableCell>
            <TableCell>{session.address}</TableCell>
            <TableCell className="text-muted-foreground">
              {session["mac-address"]}
            </TableCell>
            <TableCell>{session.uptime || "-"}</TableCell>
            <TableCell>{formatBytes(session["bytes-out"])}</TableCell>
            <TableCell>{formatBytes(session["bytes-in"])}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * Sits on a card like the loaded table does, so the page doesn't reflow
 * when the data lands.
 */
function TableSkeleton() {
  return (
    <SurfaceCard>
      <SurfaceCardHeader>
        <Skeleton className="h-5 w-32" />
      </SurfaceCardHeader>
      <SurfaceCardContent inset={false} className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </SurfaceCardContent>
    </SurfaceCard>
  )
}
