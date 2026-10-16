"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { CircleCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/system/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/providers/auth-provider";
import { PaystackBank } from "@/lib/paystack";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Panel } from "@/components/system/surface-card";
import { MaskedValue } from "@/components/system/masked-value";

export function Step3BankDetails({
  state,
  updateField,
  setError,
}: {
  state: any;
  updateField: (field: string, value: unknown) => void;
  setError: (error: string | null) => void;
}) {
  const [banks, setBanks] = useState<PaystackBank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);

  // Paystack returns the same bank under several slugs; the combobox needs
  // one entry per code, and an object identity it can match `value` against.
  const uniqueBanks = useMemo(
    () =>
      banks.filter(
        (bank, i, all) => i === all.findIndex((b) => b.code === bank.code)
      ),
    [banks]
  );
  const selectedBank =
    uniqueBanks.find((bank) => bank.code === state.bankCode) ?? null;
  const [verifying, setVerifying] = useState(false);

  // Declared above the effect that calls it, and memoised, so the effect can
  // name it as a dependency. It was a plain const below the effect, which
  // runs only because an effect fires after render - and left the effect
  // unable to declare what it actually depends on.
  const fetchBanks = useCallback(async () => {
    try {
      const response = await fetch("/api/onboarding/banks");
      const result = await response.json();
      if (result.success) {
        setBanks(result.data);
      }
    } catch {
      setError("Failed to load banks");
    } finally {
      setLoadingBanks(false);
    }
    // A Zustand action, so its identity is stable for the life of the
    // store - this effect still runs exactly once, on mount.
  }, [setError]);

  // Once, on mount: the bank list is the same for everybody and does not
  // change while somebody fills in a form.
  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  const { user } = useAuth();

  const handleVerifyAccount = async () => {
    if (!state.bankCode || state.accountNumber.length !== 10) return;

    setVerifying(true);
    setError(null);

    try {
      const token = await user?.getIdToken();

      const response = await fetch("/api/onboarding/verify-account", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          accountNumber: state.accountNumber,
          bankCode: state.bankCode,
        }),
      });

      const result = await response.json();

      if (result.success) {
        updateField("accountName", result.data.accountName);
        updateField("accountVerified", true);
      } else {
        setError(result.error || "Failed to verify account");
        updateField("accountVerified", false);
      }
    } catch {
      setError("Failed to verify account");
      updateField("accountVerified", false);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Bank Account Details</h3>
        <p className="text-sm text-muted-foreground">
          Customer payments will be sent directly to this account
        </p>
      </div>

      <div>
        <Label htmlFor="bank">Bank</Label>
        {loadingBanks ? (
          <div className="flex h-9 items-center gap-2 rounded-4xl bg-sunken px-3">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Loading banks...
            </span>
          </div>
        ) : (
          // Searchable: this list runs to hundreds of Nigerian banks, which
          // is far past what a native select is usable for.
          <Combobox
            items={uniqueBanks}
            itemToStringLabel={(bank: PaystackBank) => bank.name}
            value={selectedBank}
            onValueChange={(bank: PaystackBank | null) => {
              updateField("bankCode", bank?.code || "");
              updateField("bankName", bank?.name || "");
              updateField("accountVerified", false);
              updateField("accountName", "");
            }}
          >
            <ComboboxInput
              id="bank"
              placeholder="Search for your bank..."
              showClear={Boolean(selectedBank)}
            />
            <ComboboxContent>
              <ComboboxEmpty>No bank matches that name.</ComboboxEmpty>
              <ComboboxList>
                {(bank: PaystackBank) => (
                  <ComboboxItem key={bank.code} value={bank}>
                    {bank.name}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        )}
      </div>

      <div>
        <Label htmlFor="accountNumber">Account Number</Label>
        {/* Verify sits with the field it acts on -- it's only ever pressed
            once the ten digits are in, so separating them put the trigger
            a step away from its own input. */}
        <div className="flex gap-2">
          <Input
            id="accountNumber"
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={state.accountNumber}
            onChange={(e) => {
              const value = e.target.value.replace(/\D/g, "");
              updateField("accountNumber", value);
              updateField("accountVerified", false);
              updateField("accountName", "");
            }}
            placeholder="0123456789"
            className="md:flex-1"
          />
          <Button
            scale="sm"
            tone="action"
            onClick={handleVerifyAccount}
            disabled={
              !state.bankCode ||
              state.accountNumber.length !== 10 ||
              verifying
            }
            className="shrink-0 rounded-4xl"
          >
            {verifying ? (
              <>
                <Loader2 className="animate-spin" />
                Verifying...
              </>
            ) : (
              "Verify account"
            )}
          </Button>
        </div>
      </div>

      {state.accountVerified && state.accountName && (
        // A tinted panel with an icon tile, not a bordered alert: this is a
        // resolved value the owner should check, so the account name is the
        // thing to read, not the word "verified".
        // `bg-raised`: this Panel sits inside the wizard's own sunken inset,
        // so its default `bg-sunken` lands on the same colour as its parent.
        // White lifts it off instead.
        <Panel className="flex md:items-center gap-2 bg-raised p-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10">
            <CircleCheck className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="truncate font-medium">{state.accountName}</p>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{state.bankName}</span>
              <MaskedValue value={state.accountNumber} />
            </p>
          </div>
        </Panel>
      )}
    </div>
  );
}
