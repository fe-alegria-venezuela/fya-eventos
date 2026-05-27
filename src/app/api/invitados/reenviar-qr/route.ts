import { NextRequest } from "next/server";
import { z } from "zod";
import { applyConfirmed, getPerson } from "@/lib/mailchimp";
import { sendQrEmail } from "@/lib/email";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = logger("reenviar-qr");

const Body = z.object({
  email: z.email().transform((s) => s.toLowerCase().trim()),
});

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    log.warn("invalid JSON body");
    return Response.json({ status: "error", message: "Body inválido" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    log.warn("bad payload", { issues: parsed.error.issues });
    return Response.json({ status: "error", message: "Email inválido" }, { status: 400 });
  }
  const { email } = parsed.data;
  log.info("incoming", { email });

  const person = await getPerson(email);
  if (!person) {
    log.warn("person not found", { email });
    return Response.json({ status: "error", message: "No encontrado" }, { status: 404 });
  }
  log.info("person resolved", { email, name: person.name, tags: person.tags });

  // If the resend is triggered for someone who hadn't confirmed, also mark them confirmed
  // — the dashboard only exposes this button on confirmed contacts, but the API endpoint
  // could be called for any email.
  if (!person.hasConfirmed) {
    log.info("applying CONFIRMED tag before resending (was missing)", { email });
    await applyConfirmed(email);
  }

  const result = await sendQrEmail(email, person.name);
  if (!result.ok) {
    log.error("QR email send failed", { email, error: result.error });
    return Response.json(
      { status: "error", message: `No se pudo enviar el QR: ${result.error}` },
      { status: 502 },
    );
  }

  log.info("QR email sent", { email, resendId: result.id });
  return Response.json({
    status: "success",
    message: `QR enviado a ${person.name}`,
    name: person.name,
  });
}
