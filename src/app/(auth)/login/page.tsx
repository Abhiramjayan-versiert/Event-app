import { LoginForm } from "./login-form";
import { publicEnv } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Access is by invitation. Use the email your administrator invited.</p>
      </div>
      <LoginForm next={next} linkError={error === "link_invalid"} googleEnabled={publicEnv.googleOAuthEnabled} />
    </div>
  );
}
