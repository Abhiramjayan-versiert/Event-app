"use client";

import { ConfirmButton } from "@/components/forms/confirm-button";
import { Button } from "@/components/ui/button";
import { ExpenseRequestDialog, PromptActionButton, RecordPaymentDialog } from "@/features/finance/finance-dialogs";
import { expenseTransitionAction } from "@/features/finance/actions";
import type { ExpenseInput } from "@/lib/validations/finance";

export type ExpenseActionContext = {
  eventId: string;
  expenseId: string;
  status: string;
  currency: string;
  requested: number;
  approved: number | null;
  paid: number;
  limit: number;
  canEditOwn: boolean;
  canSubmit: boolean;
  canReview: boolean;
  canFinalApprove: boolean;
  canManage: boolean;
  department: { id: string; name: string };
  draft: Partial<ExpenseInput>;
};

export function ExpenseActions(c: ExpenseActionContext) {
  const t = (action: string, amount?: number | null, comment?: string) => expenseTransitionAction(c.eventId, c.expenseId, action, amount, comment);
  const awaiting = ["submitted", "under_review", "forwarded"].includes(c.status);
  const overLimit = c.requested > c.limit;
  const buttons: React.ReactNode[] = [];

  if (c.canEditOwn && ["draft", "changes_requested"].includes(c.status)) {
    buttons.push(
      <ExpenseRequestDialog
        key="edit"
        eventId={c.eventId}
        expenseId={c.expenseId}
        currency={c.currency}
        departments={[c.department]}
        defaults={c.draft}
        trigger={<Button variant="outline" size="sm">Edit &amp; submit</Button>}
      />,
    );
  }
  if (c.canSubmit && c.status === "draft") {
    buttons.push(<ConfirmButton key="submit" size="sm" title="Submit for review?" description="Finance will be notified." confirmLabel="Submit" action={() => t("submit")}>Submit</ConfirmButton>);
  }
  if (c.canReview && ["submitted", "forwarded"].includes(c.status)) {
    buttons.push(<ConfirmButton key="review" variant="outline" size="sm" title="Start review?" description="Marks the request as under review." confirmLabel="Start review" action={() => t("start_review")}>Start review</ConfirmButton>);
  }
  if (c.canReview && awaiting && (c.canFinalApprove || !overLimit)) {
    buttons.push(
      <PromptActionButton
        key="approve"
        variant="default"
        label="Approve"
        title="Approve expense"
        description={c.canFinalApprove ? "You can approve any amount up to the requested amount." : `You can approve up to the limit (${c.limit.toLocaleString("en-IN")}).`}
        amountLabel="Approved amount"
        defaultAmount={c.requested}
        maxAmount={c.canFinalApprove ? c.requested : Math.min(c.requested, c.limit)}
        commentLabel="Comment (optional)"
        confirmLabel="Approve"
        onSubmit={(amount, comment) => t("approve", amount, comment)}
      />,
    );
  }
  if (c.canReview && ["submitted", "under_review"].includes(c.status) && !c.canFinalApprove) {
    buttons.push(<PromptActionButton key="forward" label={overLimit ? "Forward for final approval" : "Forward"} title="Forward for final approval" commentLabel="Comment (optional)" confirmLabel="Forward" onSubmit={(_, comment) => t("forward", null, comment)} />);
  }
  if (c.canReview && awaiting) {
    buttons.push(<PromptActionButton key="changes" label="Request changes" title="Request changes" commentLabel="What needs to change?" commentRequired confirmLabel="Send back" onSubmit={(_, comment) => t("request_changes", null, comment)} />);
    buttons.push(<PromptActionButton key="reject" variant="destructive" label="Reject" title="Reject expense" commentLabel="Reason" commentRequired confirmLabel="Reject" onSubmit={(_, comment) => t("reject", null, comment)} />);
  }
  if (c.canManage && ["approved", "partially_paid"].includes(c.status) && c.approved !== null) {
    buttons.push(<RecordPaymentDialog key="pay" eventId={c.eventId} expenseId={c.expenseId} outstanding={Math.round((c.approved - c.paid) * 100) / 100} currency={c.currency} />);
  }
  const submitterCancel = c.canEditOwn && ["draft", "submitted", "changes_requested"].includes(c.status);
  const financeCancel = c.canManage && c.paid === 0 && ["draft", "submitted", "under_review", "changes_requested", "forwarded", "approved"].includes(c.status);
  if (submitterCancel || financeCancel) {
    buttons.push(<ConfirmButton key="cancel" variant="ghost" size="sm" destructive title="Cancel this request?" description="Cancelled requests stay in the history but no longer count anywhere." confirmLabel="Cancel request" action={() => t("cancel")}>Cancel request</ConfirmButton>);
  }

  if (buttons.length === 0) return null;
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}
