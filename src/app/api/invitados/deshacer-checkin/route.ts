import { NextRequest } from "next/server";
import { z } from "zod";
import { findByEmail, undoCheckin } from "@/lib/invitees";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  const person = await findByEmail(email);
  if (!person) {
    return Response.json(
      { status: "error", message: "No encontrado en la audiencia" },
      { status: 404 },
    );
  }

  if (!person.hasCheckedIn) {
    return Response.json({
      status: "already",
      message: `${person.name} no tiene asistencia registrada`,
      name: person.name,
    });
  }

  const updated = await undoCheckin(email);
  if (!updated) {
    return Response.json(
      { status: "error", message: "No se pudo revertir la asistencia" },
      { status: 502 },
    );
  }

  return Response.json({
    status: "success",
    message: `Asistencia de ${person.name} revertida`,
    name: person.name,
  });
}
