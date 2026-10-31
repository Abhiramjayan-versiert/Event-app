export type PublicCompetition = {
  code: string; name: string; category: string | null; description: string | null; fee: number;
  registration_type: "individual" | "team"; team_min: number; team_max: number;
  starts_at: string | null; venue: string | null; rules_url: string | null; spots_left: number | null;
};

export type PublicEvent = {
  id: string; name: string; slug: string; description: string | null; category: string; starts_on: string; ends_on: string;
  venue: string | null; status: string; registration_opens_at: string | null; registration_closes_at: string | null;
  contact_email: string | null; contact_phone: string | null; website_url: string | null; logo_path: string | null; banner_path: string | null;
  currency: string; timezone: string; college: { name: string; code: string }; public_page: boolean;
  allow_team_registrations: boolean; max_team_size: number; competitions: PublicCompetition[];
};

export function registrationState(e: PublicEvent, now = new Date()): { open: boolean; reason?: string } {
  if (!e.public_page) return { open: false, reason: "Online registration isn't available on this page." };
  if (["completed", "archived", "registration_closed"].includes(e.status)) return { open: false, reason: "Registrations are closed." };
  if (e.registration_opens_at && now < new Date(e.registration_opens_at)) return { open: false, reason: `Registrations open on ${new Date(e.registration_opens_at).toLocaleString("en-IN", { timeZone: e.timezone, dateStyle: "medium", timeStyle: "short" })}.` };
  if (e.registration_closes_at && now > new Date(e.registration_closes_at)) return { open: false, reason: "Registrations are closed." };
  if (e.competitions.length === 0) return { open: false, reason: "Competitions will be announced soon." };
  return { open: true };
}
