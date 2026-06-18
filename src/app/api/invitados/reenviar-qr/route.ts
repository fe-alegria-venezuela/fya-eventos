import { NextRequest } from "next/server";
import { z } from "zod";
import { getOrImportInvitee, setConfirmed } from "@/lib/invitees";
import { sendQrEmail } from "@/lib/email";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const person = await getOrImportInvitee(email);
  if (!person) {
    log.warn("person not found", { email });
    return Response.json({ status: "error", message: "No encontrado" }, { status: 404 });
  }
  log.info("person resolved", { email, name: person.name, tags: person.tags });

  // Resending the QR implies confirming — you can't hold an access pass without
  // being confirmed. Mark them confirmed in Mongo if they weren't.
  if (!person.hasConfirmed) {
    log.info("marking confirmed before resending (was missing)", { email });
    await setConfirmed(email);
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
