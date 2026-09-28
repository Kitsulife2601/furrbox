import { createFileRoute } from "@tanstack/react-router";
import { LoginPanel } from "@/components/furr/LoginPanel";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="wallpaper-bloom grid min-h-dvh place-items-center p-4">
      <LoginPanel />
    </main>
  );
}
