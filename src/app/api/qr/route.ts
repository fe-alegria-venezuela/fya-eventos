import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { buildCheckinUrl } from "@/lib/token";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = logger("qr");

const Query = z.object({
  e: z.email().transform((s) => s.toLowerCase().trim()),
  size: z.coerce.number().min(100).max(1000).optional(),
});

// Public endpoint embedded in Mailchimp emails as <img src="…/api/qr?e=*|URL:EMAIL|*">.
// Each fetch logs the recipient — useful to confirm Mailchimp actually rendered+sent the email.
export async function GET(request: NextRequest) {
  const raw = {
    e: request.nextUrl.searchParams.get("e"),
    size: request.nextUrl.searchParams.get("size") || undefined,
  };
  const ua = request.headers.get("user-agent")?.slice(0, 120);
  const referer = request.headers.get("referer");

  const parsed = Query.safeParse(raw);
  if (!parsed.success) {
    log.warn("bad query — Mailchimp may have sent literal *|URL:EMAIL|*", {
      raw,
      ua,
      referer,
      issues: parsed.error.issues,
    });
    return new Response("Invalid email", { status: 400 });
  }

  const { e: email, size = 400 } = parsed.data;
  const checkinUrl = buildCheckinUrl(email);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(checkinUrl)}`;
  log.info("serving QR", { email, ua, checkinUrl });

  return NextResponse.redirect(qrUrl, { status: 302 });
}
