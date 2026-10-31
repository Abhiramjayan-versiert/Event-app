"use client";

import { Repeat, UserPlus, UserMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { InviteDialog } from "@/components/forms/invite-dialog";
import { ConfirmButton } from "@/components/forms/confirm-button";
import { addCollegeAdminAction, endCollegeMembershipAction, replaceCollegeAdminAction } from "@/features/colleges/actions";
import { publicStorageUrl } from "@/lib/storage";
import { formatDate } from "@/lib/utils";

export type CollegeAdmin = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatarPath: string | null;
  status: string;
  startedAt: string;
};

export function CollegeAdmins({ collegeId, admins, canManage }: { collegeId: string; admins: CollegeAdmin[]; canManage: boolean }) {
  return (
    <div className="space-y-3">
      {admins.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">No college administrators assigned.</p>
      ) : (
        <ul className="divide-y">
          {admins.map((a) => (
            <li key={a.membershipId} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar name={a.name} src={publicStorageUrl("avatars", a.avatarPath)} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.name || a.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.email} · since {formatDate(a.startedAt)}</p>
                </div>
                {a.status !== "active" ? <Badge variant="warning">{a.status}</Badge> : null}
              </div>
              {canManage ? (
                <div className="flex shrink-0 items-center gap-1">
                <InviteDialog
                  trigger={<Button variant="ghost" size="sm"><Repeat /> Replace</Button>}
                  title={`Replace ${a.name || a.email}`}
                  description={`The person you enter becomes a College Admin and ${a.name || a.email} loses College Admin access. Their history is kept.`}
                  submitLabel="Replace"
                  onSubmit={(values) => replaceCollegeAdminAction(collegeId, a.membershipId, values)}
                />
                <ConfirmButton
                  variant="ghost"
                  size="sm"
                  title="Remove college administrator?"
                  description={`${a.name || a.email} will lose access to this college. The assignment stays in the audit history.`}
                  confirmLabel="Remove"
                  destructive
                  action={() => endCollegeMembershipAction(collegeId, a.membershipId)}
                >
                  <UserMinus /> Remove
                </ConfirmButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <InviteDialog
          trigger={<Button variant="outline" size="sm"><UserPlus /> Add college admin</Button>}
          title="Add college administrator"
          description="College admins manage this college, its users and all of its events."
          onSubmit={(values) => addCollegeAdminAction(collegeId, values)}
        />
      ) : null}
    </div>
  );
}
