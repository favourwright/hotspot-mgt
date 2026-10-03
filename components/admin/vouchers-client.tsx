"use client"

import { useMemo, useState } from "react"
import { Voucher } from "@/types/schemas"
import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button as SystemButton } from "@/components/system/button"
import { PageHeader } from "@/components/system/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/system/empty-state"
import {
  ChevronDown,
  Copy,
  CircleCheck,
  Search,
  TicketIcon,
} from "lucide-react"
import { copyTextToClipboard } from "@/lib/clipboard"

const STATUS_OPTIONS = [
  { value: "all", label: "All status" },
  { value: "active", label: "Active" },
  { value: "failed", label: "Failed" },
  { value: "expired", label: "Expired" },
] as const

interface VouchersClientProps {
  initialVouchers: Voucher[]
  tenantSlug: string
}

export function VouchersClient({
  initialVouchers,
  tenantSlug,
}: VouchersClientProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const filteredVouchers = useMemo(() => {
    let filtered = initialVouchers

    if (statusFilter !== "all") {
      filtered = filtered.filter((v) => v.status === statusFilter)
    }

    if (searchTerm) {
      filtered = filtered.filter(
        (v) =>
          v.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
          v.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
          v.locationName.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    return filtered
  }, [searchTerm, statusFilter, initialVouchers])

  const copyToClipboard = async (text: string, field: string) => {
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopiedField(field)
      setTimeout(() => setCopiedField(null), 2000)
    }
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default"
      case "failed":
        return "destructive"
      case "expired":
        return "secondary"
      default:
        return "secondary"
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vouchers"
        description={`Complete voucher history (${filteredVouchers.length} of ${initialVouchers.length})`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by username, email or location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SystemButton tone="raised" scale="sm" />}
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
          <SurfaceCardTitle>Vouchers</SurfaceCardTitle>
          <SurfaceCardDescription>
            {filteredVouchers.length} vouchers found
          </SurfaceCardDescription>
        </SurfaceCardHeader>
        <SurfaceCardContent>
          {filteredVouchers.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TicketIcon />
                </EmptyMedia>
                <EmptyTitle>No Vouchers Found</EmptyTitle>
                <EmptyDescription>
                  {initialVouchers.length === 0
                    ? "No vouchers have been generated yet. Vouchers will appear here after customers make purchases."
                    : "No vouchers match your current filters. Try adjusting your search or filter criteria."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Password</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredVouchers.map((voucher) => (
                  <TableRow key={voucher.id}>
                    <TableCell className="text-sm">
                      {formatDate(voucher.createdAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {voucher.userEmail}
                    </TableCell>
                    <TableCell>{voucher.locationName}</TableCell>
                    <TableCell>{voucher.planName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-xs">{voucher.username}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              voucher.username,
                              `username-${voucher.id}`
                            )
                          }
                        >
                          {copiedField === `username-${voucher.id}` ? (
                            <CircleCheck className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-xs">{voucher.password}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            copyToClipboard(
                              voucher.password,
                              `password-${voucher.id}`
                            )
                          }
                        >
                          {copiedField === `password-${voucher.id}` ? (
                            <CircleCheck className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>{voucher.duration}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(voucher.status)}>
                        {voucher.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SurfaceCardContent>
      </SurfaceCard>
    </div>
  )
}
