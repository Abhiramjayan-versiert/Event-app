# Deployment (Supabase + Vercel)

Use **separate Supabase projects** for development/staging and production. Never reuse keys between them.

## 1. Supabase project

1. Create a project (region close to your users, e.g. `ap-south-1` for India).
2. Apply the migrations from your machine:

   ```bash
   supabase link --project-ref <ref>
   ```

   ```bash
   supabase db push
   ```

   Do **not** run `supabase/seed.sql` outside local development.
3. Under **Authentication → Sign In / Providers**, disable "Allow new users to sign up" (the platform is invitation-only), keep email confirmations on, and set the minimum password length to 10.
4. Under **Authentication → URL Configuration**, set the Site URL to `https://<your-domain>` and add these redirect URLs:
   - `https://<your-domain>/auth/callback`
   - `https://<your-domain>/auth/confirm`
5. Under **Authentication → Email Templates**, paste the templates from `supabase/templates/` (Invite, Reset Password, Confirm signup, Change email). They link to `/auth/confirm?token_hash=…`, which the app verifies server-side.
6. Under **Authentication → SMTP**, configure your own SMTP provider. The built-in sender is rate-limited and meant for testing only.
7. Optional Google OAuth: enable the provider, add the client ID and secret, and set `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH=true`. Google users still need an assignment before they see anything.
8. Check **Storage**: the buckets `documents` (private), `avatars` and `branding` (public) are created by migration 5.
9. Under **Database → Backups**, enable Point-in-Time Recovery for production.

## 2. Vercel

1. Import the GitHub repository into Vercel (framework preset: Next.js).
2. Set the environment variables for **Production** and **Preview** separately:

   | Variable | Value | Exposure |
   |---|---|---|
   | `NEXT_PUBLIC_APP_URL` | `https://<your-domain>` | public |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL | public |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key | public |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key | **server only** |
   | `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | `true` / `false` | public |
   | `PAYMENT_PROVIDER`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Phase 5 | **server only** |

3. Deploy, then add your domain under **Settings → Domains** and update `NEXT_PUBLIC_APP_URL` and the Supabase Site URL to match.
4. Provision the first Super Admin; see the README section "Creating the first Super Admin".

## 3. Production checklist

- [ ] Migrations applied; `supabase migration list` shows no drift
- [ ] Sign-ups disabled, SMTP configured, branded templates installed, redirect URLs set
- [ ] Service role key present only in Vercel server env and not in any `NEXT_PUBLIC_*` variable
- [ ] First Super Admin provisioned; test login, password reset and invitation acceptance
- [ ] Create a test college → event: 18 departments and 10 sponsorship packages appear
- [ ] Invite a College Admin and an Event Admin; verify each sees only their scope
- [ ] Upload a college logo and a profile picture (storage policies)
- [ ] Dashboards load; the event dashboard hides finance figures for non-finance roles
- [ ] PITR and backups enabled, off-site dump scheduled
- [ ] Supabase Security Advisor shows no critical findings
- [ ] Vercel production deployment uses the production Supabase project, and previews use staging
