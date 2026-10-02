"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleHelp, Store } from "lucide-react";

import {
  SurfaceCard,
  SurfaceCardContent,
  SurfaceCardDescription,
  SurfaceCardHeader,
  SurfaceCardTitle,
} from "@/components/system/surface-card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/system/tabs";
import { Button } from "@/components/system/button";
import { PageContent } from "@/components/system/page-content";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";

export default function AuthPage() {
  const [activeTab, setActiveTab] = useState<string>("login");

  return (
    <>
      {/* Occupies the band a nav bar would, so the page still opens on a
          horizontal object rather than straight into the form. */}
      <div className="flex items-center gap-3">
        <SurfaceCard
          className="flex-1"
          action={{ label: "Get started", href: "/onboarding" }}
        >
          <SurfaceCardHeader>
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sunken">
                <Store className="size-5" />
              </span>
              <div className="min-w-0">
                <SurfaceCardTitle className="truncate text-base">
                  Run your own hotspot business
                </SurfaceCardTitle>
                <SurfaceCardDescription className="truncate">
                  Sell vouchers and manage your routers from one dashboard.
                </SurfaceCardDescription>
              </div>
            </div>
          </SurfaceCardHeader>
        </SurfaceCard>

        <Button
          tone="raised"
          nativeButton={false}
          render={<Link href="/faq" />}
          aria-label="Help and FAQ"
        >
          <CircleHelp />
          <span className="hidden sm:inline">FAQ</span>
        </Button>
      </div>

      <PageContent className="items-center justify-center">
        <div className="w-full max-w-md">
          <SurfaceCard>
            <SurfaceCardHeader className="text-center">
              <SurfaceCardTitle className="text-2xl">Welcome</SurfaceCardTitle>
              <SurfaceCardDescription>
                Login or create an account to get started
              </SurfaceCardDescription>
            </SurfaceCardHeader>
            <SurfaceCardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="register">Register</TabsTrigger>
                </TabsList>
                <TabsContent value="login" className="mt-6">
                  <LoginForm
                    onSwitchToRegister={() => setActiveTab("register")}
                  />
                </TabsContent>
                <TabsContent value="register" className="mt-6">
                  <RegisterForm onSwitchToLogin={() => setActiveTab("login")} />
                </TabsContent>
              </Tabs>
            </SurfaceCardContent>
          </SurfaceCard>

          <p className="mt-6 px-8 text-center text-sm text-muted-foreground">
            By continuing, you agree to our{" "}
            <a href="#" className="underline hover:text-foreground">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="underline hover:text-foreground">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </PageContent>
    </>
  );
}
