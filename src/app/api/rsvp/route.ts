import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyConfirmed, applyDeclined, getPerson } from "@/lib/mailchimp";
import { sendQrEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = logger("rsvp");

const Query = z.object({
  r: z.enum(["yes", "no"]),
  e: z.email().transform((s) => s.toLowerCase().trim()),
});

function redirectTo(status: string, name?: string): NextResponse {
  const url = new URL("/rsvp", env.BASE_URL());
  url.searchParams.set("status", status);
  if (name) url.searchParams.set("name", name);
  return NextResponse.redirect(url, { status: 303 });
}

export async function GET(request: NextRequest) {
  const raw = {
    r: request.nextUrl.searchParams.get("r"),
    e: request.nextUrl.searchParams.get("e"),
  };
  log.info("incoming", { raw, ua: request.headers.get("user-agent")?.slice(0, 80) });

  const parsed = Query.safeParse(raw);
  if (!parsed.success) {
    log.warn("bad query", { issues: parsed.error.issues });
    return redirectTo("error");
  }
  const { r, e: email } = parsed.data;

  const person = await getPerson(email);
  if (!person) {
    log.warn("person not found in Mailchimp audience", { email });
    return redirectTo("not-found");
  }
  log.info("person resolved", { email, name: person.name, currentTags: person.tags });

  const ok = r === "yes" ? await applyConfirmed(email) : await applyDeclined(email);
  if (!ok) {
    log.error("tag write returned not-ok", { email, r });
    return redirectTo("error", person.firstName);
  }

  if (r === "yes") {
    // Fire-and-don't-block: still redirect even if mail fails. We log it so it can be
    // resent from the dashboard via "Reenviar QR".
    const result = await sendQrEmail(email, person.name);
    if (!result.ok) {
      log.error("QR email FAILED — tag is applied but recipient did NOT get the QR", {
        email,
        error: result.error,
      });
    } else {
      log.info("rsvp + QR email complete", { email, resendId: result.id });
    }
  } else {
    log.info("rsvp declined", { email });
  }

  return redirectTo(r === "yes" ? "success" : "declined", person.firstName);
}
