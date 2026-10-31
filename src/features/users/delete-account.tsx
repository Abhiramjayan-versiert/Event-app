"use client";

import { TypedDeleteDialog } from "@/components/shared/typed-delete-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { deleteUserAccountAction } from "@/features/users/actions";

/** Super Admin: permanently delete an account so the person can be invited again as new. */
export function DeleteAccountCard({ userId, email, name }: { userId: string; email: string; name: string }) {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Delete account</CardTitle>
        <CardDescription>
          Permanently deletes this person&apos;s login and ends all their roles. Records they created (tasks, expenses, registrations) are kept, but
          no longer show their name. Their email becomes free, so you can invite them again as a brand-new user with a fresh role. To pause access
          instead, suspend the account from the Users list.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <TypedDeleteDialog
          label="Delete account"
          title={`Delete ${name || email}'s account?`}
          description={<p>This cannot be undone. They are signed out everywhere and must be invited again to come back.</p>}
          name={email}
          onDelete={(typed) => deleteUserAccountAction(userId, typed)}
          redirectTo="/users"
        />
      </CardContent>
    </Card>
  );
}
