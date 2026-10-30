import { SetPasswordForm } from "./set-password-form";

export const metadata = { title: "Set password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const isInvite = welcome === "1";
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{isInvite ? "Welcome to EVENT APP" : "Choose a new password"}</h1>
        <p className="text-sm text-muted-foreground">
          {isInvite ? "Your account is ready. Set a password to finish signing in." : "Use at least 10 characters with letters and numbers."}
        </p>
      </div>
      <SetPasswordForm />
    </div>
  );
}
