import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildCheckinUrl } from "@/lib/token";

export const dynamic = "force-dynamic";

const Query = z.object({
  e: z.email().transform((s) => s.toLowerCase().trim()),
  size: z.coerce.number().min(100).max(1000).optional(),
});

// Public endpoint embedded in Mailchimp emails as <img src="…/api/qr?e=*|URL:EMAIL|*">.
// Builds the signed checkin URL for the given email, then redirects to qrserver.com
// to generate the QR image. Redirecting (vs proxying bytes) is cheaper and lets the
// image be cached by the recipient's mail client.
export async function GET(request: NextRequest) {
  const parsed = Query.safeParse({
    e: request.nextUrl.searchParams.get("e"),
    size: request.nextUrl.searchParams.get("size") || undefined,
  });

  if (!parsed.success) {
    return new Response("Invalid email", { status: 400 });
  }

  const { e: email, size = 400 } = parsed.data;
  const checkinUrl = buildCheckinUrl(email);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(checkinUrl)}`;

  return NextResponse.redirect(qrUrl, { status: 302 });
}
