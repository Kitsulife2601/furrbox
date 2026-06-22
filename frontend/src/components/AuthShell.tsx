"use client";

import { useEffect, useState } from "react";
import { Desktop } from "@/components/Desktop";
import { LockScreen } from "@/components/LockScreen";
import { LoginPanel } from "@/components/LoginPanel";
import { me } from "@/lib/auth";
import { useFurrBoxStore } from "@/store/furrbox-store";

export function AuthShell() {
  const { authStage, token, setAuthStage, setSession, logout } = useFurrBoxStore();
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !token) return;
    me(token)
      .then((user) => setSession(token, user))
      .catch(() => logout());
  }, [hydrated, logout, setSession, token]);

  if (!hydrated) return <main className="h-screen w-screen desktop-wallpaper" />;
  if (authStage === "lock") return <LockScreen onUnlock={() => setAuthStage(token ? "desktop" : "login")} />;
  if (!token || authStage === "login") return <LoginPanel />;
  return <Desktop />;
}
