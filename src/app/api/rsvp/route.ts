import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { applyConfirmed, applyDeclined, getPerson } from "@/lib/mailchimp";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

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
  const parsed = Query.safeParse({
    r: request.nextUrl.searchParams.get("r"),
    e: request.nextUrl.searchParams.get("e"),
  });

  if (!parsed.success) return redirectTo("error");
  const { r, e: email } = parsed.data;

  const person = await getPerson(email);
  if (!person) return redirectTo("not-found");

  const ok = r === "yes" ? await applyConfirmed(email) : await applyDeclined(email);
  if (!ok) return redirectTo("error", person.firstName);

  return redirectTo(r === "yes" ? "success" : "declined", person.firstName);
}
