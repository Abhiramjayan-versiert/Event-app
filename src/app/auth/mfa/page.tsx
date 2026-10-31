import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/actions";
import { MfaChallengeForm } from "@/features/profile/two-step";

export const metadata = { title: "Two-step sign-in" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const next = safeRedirectPath((await searchParams).next, "/dashboard");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Logo size="lg" />
      <div className="w-full max-w-sm space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-xl font-semibold">Enter your sign-in code</h1>
          <p className="text-sm text-muted-foreground">Open your authenticator app and type the 6-digit code for EVENT APP.</p>
        </div>
        <MfaChallengeForm next={next} />
        <form action="/auth/signout" method="post" className="text-center">
          <button type="submit" className="text-sm text-muted-foreground underline-offset-4 hover:underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}
