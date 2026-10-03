import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Placeholder for the payment flow. No payment provider is connected and nothing is
// charged: Pro access is issued as an access key (PRO_ACCESS_KEYS) until the business
// model is confirmed. See docs/PLANS_AND_BILLING.md for the Stripe integration steps.
export async function POST() {
  return NextResponse.json(
    {
      error: "Online payment is not enabled yet. Pro access is granted with an access key from the administrator.",
      code: "BILLING_NOT_ENABLED",
    },
    { status: 501 },
  );
}
