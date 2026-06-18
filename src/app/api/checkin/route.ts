import { NextRequest } from "next/server";
import { z } from "zod";
import { getOrImportInvitee, setCheckin } from "@/lib/invitees";
import { appendCheckin } from "@/lib/sheets";
import { verifyToken } from "@/lib/token";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = logger("checkin");

const Body = z.object({
  token: z.string().min(1),
  email: z.email().transform((s) => s.toLowerCase().trim()),
  override: z.boolean().optional(),
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
    return Response.json({ status: "error", message: "Datos inválidos" }, { status: 400 });
  }
  const { token, email, override } = parsed.data;
  log.info("incoming", { email, override });

  if (!verifyToken(token, email)) {
    log.warn("HMAC token verification failed", { email });
    return Response.json({ status: "error", message: "Token inválido" }, { status: 403 });
  }

  const person = await getOrImportInvitee(email);
  if (!person) {
    log.warn("person not found", { email });
    return Response.json({ status: "error", message: "Invitado no encontrado" }, { status: 404 });
  }
  log.info("person resolved", { email, name: person.name, tags: person.tags });

  if (person.hasCheckedIn) {
    log.info("already checked in", { email });
    return Response.json({ status: "already", message: "Ya hizo check-in", name: person.name });
  }

  if (!person.hasConfirmed && !override) {
    log.info("needs override (not confirmed)", { email });
    return Response.json({
      status: "needs-override",
      message: "Este invitado no había confirmado",
      name: person.name,
    });
  }

  const updated = await setCheckin(email);
  if (!updated) {
    log.error("setCheckin failed", { email });
    return Response.json(
      { status: "error", message: "No se pudo registrar el check-in" },
      { status: 502 },
    );
  }

  // Best-effort: log to Google Sheets (data activa del día). NUNCA bloquea el check-in.
  const sheet = await appendCheckin({ email, name: person.name });
  if (!sheet.ok) {
    log.warn("sheet append failed — check-in still registered in Mongo", {
      email,
      error: sheet.error,
    });
  }

  log.info("check-in complete", { email, name: person.name, sheet: sheet.ok });
  return Response.json({ status: "success", message: "Check-in registrado", name: person.name });
}
