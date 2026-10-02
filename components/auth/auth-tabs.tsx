"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/system/tabs";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

// `reset` is a view, not a tab: it takes the card over rather than sitting
// alongside the other two, but it still lives in the URL so a reload during
// the detour doesn't drop you back on the login form.
const TABS = ["login", "register", "reset"] as const;
type AuthTab = (typeof TABS)[number];

export const AUTH_TAB_PARAM = "tab";

function parseTab(value: string | null): AuthTab {
  return TABS.includes(value as AuthTab) ? (value as AuthTab) : "login";
}

/**
 * The URL is the only source of truth for which tab is open, so a reload or
 * a shared link lands on the same form.
 *
 * Writing it back with `history.replaceState` rather than `router.replace`
 * is deliberate: Next patches the history methods into its router, so
 * `useSearchParams` above still re-renders, but switching tabs costs no RSC
 * round trip and leaves no history entry to back out of one tab at a time.
 */
export function AuthTabs() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = parseTab(searchParams.get(AUTH_TAB_PARAM));
  // Carried across the handoff so the reset form opens with whatever was
  // already typed into the login field.
  const [email, setEmail] = useState("");

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(AUTH_TAB_PARAM, parseTab(value));
    window.history.replaceState(null, "", `${pathname}?${params}`);
  };

  if (activeTab === "reset") {
    return (
      <ForgotPasswordForm
        initialEmail={email}
        onBackToLogin={() => setTab("login")}
      />
    );
  }

  return (
    <Tabs value={activeTab} onValueChange={setTab}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Login</TabsTrigger>
        <TabsTrigger value="register">Register</TabsTrigger>
      </TabsList>
      <TabsContent value="login" className="mt-6">
        <LoginForm
          onSwitchToRegister={() => setTab("register")}
          onForgotPassword={(value) => {
            setEmail(value);
            setTab("reset");
          }}
        />
      </TabsContent>
      <TabsContent value="register" className="mt-6">
        <RegisterForm onSwitchToLogin={() => setTab("login")} />
      </TabsContent>
    </Tabs>
  );
}
