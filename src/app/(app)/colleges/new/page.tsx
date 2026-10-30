import { requireSuperAdmin } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { CollegeForm } from "@/features/colleges/college-form";

export const metadata = { title: "New college" };

export default async function NewCollegePage() {
  await requireSuperAdmin();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="New college" description="Add an institution. You can upload its logo and appoint administrators next." />
      <CollegeForm />
    </div>
  );
}
