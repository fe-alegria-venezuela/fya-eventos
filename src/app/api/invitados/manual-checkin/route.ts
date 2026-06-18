import { NextRequest } from "next/server";
import { z } from "zod";
import { getOrImportInvitee, setCheckin, setConfirmed } from "@/lib/invitees";
import { appendCheckin } from "@/lib/sheets";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = logger("manual-checkin");

const Body = z.object({
  email: z.email().transform((s) => s.toLowerCase().trim()),
});

export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ status: "error", message: "Body inválido" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ status: "error", message: "Email inválido" }, { status: 400 });
  }
  const { email } = parsed.data;

  const person = await getOrImportInvitee(email);
  if (!person) {
    return Response.json(
      { status: "error", message: "No encontrado en la audiencia" },
      { status: 404 },
    );
  }

  if (person.hasCheckedIn) {
    return Response.json({
      status: "already",
      message: `${person.name} ya hizo check-in`,
      name: person.name,
    });
  }

  // If they hadn't confirmed, confirm them on the spot — they showed up.
  if (!person.hasConfirmed) {
    await setConfirmed(email);
  }
  const updated = await setCheckin(email);
  if (!updated) {
    return Response.json(
      { status: "error", message: "No se pudo registrar el check-in" },
      { status: 502 },
    );
  }

  const sheet = await appendCheckin({ email, name: person.name, detail: "Check-in manual" });
  if (!sheet.ok) {
    log.warn("sheet append failed — check-in still registered", { email, error: sheet.error });
  }

  return Response.json({
    status: "success",
    message: `Check-in de ${person.name} registrado`,
    name: person.name,
  });
}
