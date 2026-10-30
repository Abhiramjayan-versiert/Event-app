import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CollegeForm } from "@/features/colleges/college-form";
import { CollegeLogo } from "@/features/colleges/college-logo";
import { Crumb } from "@/components/layout/shell-context";

export const metadata = { title: "Edit college" };

export default async function EditCollegePage({ params }: { params: Promise<{ collegeId: string }> }) {
  const { collegeId } = await params;
  await requireAccess();
  const supabase = await createClient();
  const [{ data: college }, { data: canManage }] = await Promise.all([
    supabase.from("colleges").select("*").eq("id", collegeId).maybeSingle(),
    supabase.rpc("check_permission", { p_scope: "college", p_id: collegeId, p_permission: "college.manage" }),
  ]);
  if (!college || !canManage) notFound();

  return (
    <div className="max-w-3xl space-y-6">
      <Crumb id={college.id} label={college.name} />
      <PageHeader title="Edit college" description={college.name} />
      <Card>
        <CardHeader>
          <CardTitle>College logo</CardTitle>
          <CardDescription>Shown in the college workspace and reports. PNG, JPG, WebP or SVG up to 5 MB.</CardDescription>
        </CardHeader>
        <CardContent>
          <CollegeLogo collegeId={college.id} logoPath={college.logo_path} />
        </CardContent>
      </Card>
      <CollegeForm
        collegeId={college.id}
        defaults={{
          name: college.name, code: college.code, email: college.email ?? "", website: college.website ?? "", phone: college.phone ?? "",
          address: college.address ?? "", city: college.city ?? "", state: college.state ?? "", country: college.country,
          description: college.description ?? "", status: college.status === "inactive" ? "inactive" : "active",
        }}
      />
    </div>
  );
}
