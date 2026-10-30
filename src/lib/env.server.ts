import "server-only";

function required(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required server environment variable ${name}. See .env.example.`);
  }
  return value;
}

/** Server-only secrets. Importing this file from client code fails the build. */
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required("SUPABASE_SERVICE_ROLE_KEY");
  },
  paymentProvider: process.env.PAYMENT_PROVIDER ?? "razorpay",
  get razorpayWebhookSecret() {
    return required("RAZORPAY_WEBHOOK_SECRET");
  },
};
