import { NextRequest } from "next/server";
import { z } from "zod";
import { applyCheckin, getPerson } from "@/lib/mailchimp";
import { verifyToken } from "@/lib/token";

export const dynamic = "force-dynamic";

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
    return Response.json({ status: "error", message: "Body inválido" }, { status: 400 });
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ status: "error", message: "Datos inválidos" }, { status: 400 });
  }
  const { token, email, override } = parsed.data;

  if (!verifyToken(token, email)) {
    return Response.json({ status: "error", message: "Token inválido" }, { status: 403 });
  }

  const person = await getPerson(email);
  if (!person) {
    return Response.json({ status: "error", message: "Invitado no encontrado" }, { status: 404 });
  }

  if (person.hasCheckedIn) {
    return Response.json({ status: "already", message: "Ya hizo check-in", name: person.name });
  }

  if (!person.hasConfirmed && !override) {
    return Response.json({
      status: "needs-override",
      message: "Este invitado no había confirmado",
      name: person.name,
    });
  }

  const ok = await applyCheckin(email);
  if (!ok) {
    return Response.json(
      { status: "error", message: "No se pudo registrar el check-in" },
      { status: 502 },
    );
  }

  return Response.json({ status: "success", message: "Check-in registrado", name: person.name });
}
