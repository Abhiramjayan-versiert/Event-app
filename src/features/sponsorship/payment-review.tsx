"use client";

import { ConfirmButton } from "@/components/forms/confirm-button";
import { PromptActionButton } from "@/features/finance/finance-dialogs";
import { verifySponsorshipPaymentAction } from "@/features/sponsorship/actions";

export function PaymentReview({ eventId, paymentId }: { eventId: string; paymentId: string }) {
  return (
    <div className="flex gap-1">
      <ConfirmButton size="sm" title="Verify sponsorship payment?" description="Confirm the money is in the event account. It will be booked as sponsorship income." confirmLabel="Verify" action={() => verifySponsorshipPaymentAction(eventId, paymentId, true)}>Verify</ConfirmButton>
      <PromptActionButton label="Reject" title="Reject payment" commentLabel="Reason" commentRequired confirmLabel="Reject" onSubmit={(_, note) => verifySponsorshipPaymentAction(eventId, paymentId, false, note)} />
    </div>
  );
}
