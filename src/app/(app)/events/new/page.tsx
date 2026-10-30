import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/auth/session";
import { PageHeader } from "@/components/shared/page-header";
import { EventForm } from "@/features/events/event-form";
import { collegesForEventCreation } from "@/features/events/queries";

export const metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ college?: string }> }) {
  const access = await requireAccess();
  const colleges = await collegesForEventCreation(access);
  if (colleges.length === 0) notFound();
  const { college } = await searchParams;
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="New event"
        description="Creating an event generates its workspace: settings, budget, 18 default departments and sponsorship packages."
      />
      <EventForm colleges={colleges} defaults={college && colleges.some((c) => c.id === college) ? { college_id: college } : undefined} />
    </div>
  );
}
