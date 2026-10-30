import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AvatarUploader, ChangePasswordForm, ProfileForm } from "@/features/profile/profile-forms";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const access = await requireAccess();
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("full_name, phone, job_title, avatar_path, created_at").eq("id", access.user_id).single();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile" description={access.email} />
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>Visible to people you work with in your colleges and events.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AvatarUploader userId={access.user_id} name={profile?.full_name ?? access.email} avatarPath={profile?.avatar_path ?? null} />
          <ProfileForm defaults={{ full_name: profile?.full_name ?? "", phone: profile?.phone ?? "", job_title: profile?.job_title ?? "" }} />
        </CardContent>
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
