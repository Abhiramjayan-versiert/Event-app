import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Account suspended" };

export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo size="lg" />
      <div className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">Your account is suspended</h1>
        <p className="text-sm text-muted-foreground">Contact your EVENT APP administrator to restore access.</p>
      </div>
      <form action="/auth/signout" method="post">
        <Button variant="outline" type="submit">Sign out</Button>
      </form>
    </main>
  );
}
