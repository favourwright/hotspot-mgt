"use client";

import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/system/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/system/button";
import { PageHeader } from "@/components/system/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/system/tabs";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/system/empty-state";
import { AlertTriangle, ChevronDown, Users, Wifi, WifiOff } from "lucide-react";
import { useHotspotUsers } from "@/hooks/use-hotspot-users";
import { useActiveSessions } from "@/hooks/use-active-sessions";
import { LiveToggle, useLivePreference } from "@/components/admin/live-toggle";
import type { MergedHotspotUser, UserStatus } from "@/lib/hotspot-users";

interface HotspotUsersClientProps {
  locations: { id: string; name: string }[];
}

const STATUS_LABEL: Record<UserStatus, string> = {
  active: "Active",
  expired: "Expired",
  disabled: "Disabled",
  "missing-on-router": "Not on router",
};

const STATUS_VARIANT: Record<
  UserStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  expired: "secondary",
  disabled: "outline",
  "missing-on-router": "destructive",
};

/** Tracks whether this tab is in the foreground, for the Live indicator. */
function useTabVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    onChange();
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}

function formatBytes(value: string | undefined): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function HotspotUsersClient({ locations }: HotspotUsersClientProps) {
  const [locationId, setLocationId] = useState<string | null>(
    locations[0]?.id ?? null
  );
  const [tab, setTab] = useState("users");
  const [live, setLive] = useLivePreference(true);
  const tabVisible = useTabVisible();

  const users = useHotspotUsers(locationId);
  const sessions = useActiveSessions(locationId, live && tab === "active");

  if (locations.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Users" description="Hotspot users across your locations" />
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <Users />
            </EmptyMedia>
            <EmptyTitle>No locations yet</EmptyTitle>
            <EmptyDescription>
              Add a location and connect a router to see its hotspot users here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const data = users.data;
  const sessionData = sessions.data;

  const liveState = !live
    ? ("off" as const)
    : sessions.gaveUp || sessionData?.reachable === false
      ? ("failing" as const)
      : !tabVisible
        ? ("paused-hidden" as const)
        : ("polling" as const);

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
                onValueChange={(value) => value && setLocationId(value)}
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

      <Tabs value={tab} onValueChange={(value) => setTab(value as string)}>
        {/* Tabs and the live controls share one row: both act on the same
            table, and the toggle only appears for the tab it actually
            drives, so it never implies control over the Users list. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="users">
              Users{data ? ` (${data.counts.total})` : ""}
            </TabsTrigger>
            <TabsTrigger value="active">
              Active now{sessionData ? ` (${sessionData.sessions.length})` : ""}
            </TabsTrigger>
          </TabsList>

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
            <Alert variant="destructive">
              <AlertDescription>
                Could not load users for this location.
              </AlertDescription>
            </Alert>
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
                    {data.counts.needsAttention === 1 ? "user needs" : "users need"}{" "}
                    attention - the platform and the router disagree about them.
                  </AlertDescription>
                </Alert>
              )}

              <UsersTable users={data.users} />
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="active" className="mt-4">
          {sessions.isLoading ? (
            <TableSkeleton />
          ) : sessionData && !sessionData.reachable ? (
            <Alert variant="destructive">
              <WifiOff className="size-4" />
              <AlertDescription className="flex items-center justify-between gap-4">
                <span>
                  Couldn&apos;t reach {sessionData.routerName}: {sessionData.error}
                  {sessions.gaveUp && " - stopped retrying."}
                </span>
                {sessions.gaveUp && (
                  <Button tone="raised" onClick={sessions.resume}>
                    Retry
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          ) : sessionData && sessionData.sessions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia>
                  <Wifi />
                </EmptyMedia>
                <EmptyTitle>Nobody connected right now</EmptyTitle>
                <EmptyDescription>
                  Active sessions appear here as people log in.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : sessionData ? (
            <SessionsTable sessions={sessionData.sessions} />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UsersTable({ users }: { users: MergedHotspotUser[] }) {
  if (users.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia>
            <Users />
          </EmptyMedia>
          <EmptyTitle>No hotspot users yet</EmptyTitle>
          <EmptyDescription>
            Users appear here once vouchers are sold or created on the router.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
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
              <Badge variant={user.source === "platform" ? "secondary" : "outline"}>
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
            <TableCell>{formatDate(user.expiresAt)}</TableCell>
            <TableCell className="text-muted-foreground">
              {user.customerEmail ?? "-"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SessionsTable({
  sessions,
}: {
  sessions: { ".id": string; user: string; address: string; "mac-address": string; "session-time": string; "bytes-in": string; "bytes-out": string }[];
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>IP address</TableHead>
          <TableHead>MAC</TableHead>
          <TableHead>Session time</TableHead>
          <TableHead>Downloaded</TableHead>
          <TableHead>Uploaded</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session[".id"]}>
            <TableCell className="font-medium">{session.user}</TableCell>
            <TableCell>{session.address}</TableCell>
            <TableCell className="text-muted-foreground">
              {session["mac-address"]}
            </TableCell>
            <TableCell>{session["session-time"] || "-"}</TableCell>
            <TableCell>{formatBytes(session["bytes-out"])}</TableCell>
            <TableCell>{formatBytes(session["bytes-in"])}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
