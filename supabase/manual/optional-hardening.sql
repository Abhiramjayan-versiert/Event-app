-- EVENT APP — optional defence-in-depth (run once in the Supabase SQL editor).
--
-- These tables are already protected: row level security is on and there are
-- no insert/update/delete policies, so signed-in users cannot write to them;
-- every change goes through the checked database functions. Removing the
-- table-level write privileges as well is a second lock. (Supabase asks for
-- confirmation before running privilege changes, which is why these lines are
-- kept out of the automatic migrations.)

revoke insert, update, delete on
  public.judging_criteria, public.competition_judges, public.judging_scores, public.competition_results,
  public.certificates,
  public.duty_shifts, public.duty_assignments,
  public.surveys, public.survey_responses, public.survey_invites,
  public.push_subscriptions
from authenticated, anon;

revoke all on app.push_config from public, anon, authenticated;
