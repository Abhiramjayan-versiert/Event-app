import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvatarUploader, ChangePasswordForm, ProfileForm } from "@/features/profile/profile-forms";
import { CalendarSync } from "@/features/profile/calendar-sync";
import { TwoStepSettings } from "@/features/profile/two-step";
import { PushSettings } from "@/features/push/push-settings";
import { publicEnv } from "@/lib/env";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const access = await requireAccess();
  const supabase = await createClient();
  // my_profile() returns the real details even for the Super Admin, whose public profile reads "Contact Admin".
  const { data } = await supabase.rpc("my_profile");
  const profile = data as { full_name: string; phone: string | null; job_title: string | null; avatar_path: string | null; created_at: string } | null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile" description={access.email} />
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>
            {access.is_super_admin
              ? "Private. Everyone else sees the Super Admin as “Contact Admin”."
              : "Visible to people you work with in your colleges and events."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AvatarUploader userId={access.user_id} name={profile?.full_name ?? access.email} avatarPath={profile?.avatar_path ?? null} />
          <ProfileForm defaults={{ full_name: profile?.full_name ?? "", phone: profile?.phone ?? "", job_title: profile?.job_title ?? "" }} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notifications on this device</CardTitle>
          <CardDescription>Get task deadlines, approvals, duties and announcements as phone or desktop notifications.</CardDescription>
        </CardHeader>
        <CardContent><PushSettings /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Two-step sign-in</CardTitle>
          <CardDescription>Protect your account with a code from your phone in addition to your password.</CardDescription>
        </CardHeader>
        <CardContent><TwoStepSettings /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Calendar sync</CardTitle>
          <CardDescription>See your events, their schedules and your task deadlines in Google, Apple or Outlook Calendar.</CardDescription>
        </CardHeader>
        <CardContent><CalendarSync appUrl={publicEnv.appUrl} /></CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Access</CardTitle>
          <CardDescription>Your roles across the platform. Contact an administrator to change them.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {access.is_super_admin ? <Badge variant="lime">Super Admin</Badge> : null}
          {access.colleges.flatMap((c) => c.roles.map((r) => <Badge key={`${c.id}-${r}`} variant="muted">College Admin · {c.code}</Badge>))}
          {access.events.flatMap((e) => e.roles.map((r, i) => (
            <Badge key={`${e.id}-${i}`} variant="muted">{r.role_name}{r.department_name ? ` · ${r.department_name}` : ""} · {e.name}</Badge>
          )))}
          {!access.is_super_admin && access.colleges.length === 0 && access.events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assignments yet.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Password</CardTitle></CardHeader>
        <CardContent><ChangePasswordForm /></CardContent>
      </Card>
    </div>
  );
}
