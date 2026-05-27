import { NextRequest } from "next/server";
import { z } from "zod";
import { getPerson, reapplyConfirmedTag } from "@/lib/mailchimp";

export const dynamic = "force-dynamic";

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

  const person = await getPerson(email);
  if (!person) {
    return Response.json({ status: "error", message: "No encontrado" }, { status: 404 });
  }

  // Re-apply CONFIRMED tag to re-trigger the Mailchimp Customer Journey that sends the QR.
  const ok = await reapplyConfirmedTag(email);
  if (!ok) {
    return Response.json(
      { status: "error", message: "No se pudo reenviar el QR" },
      { status: 502 },
    );
  }

  return Response.json({
    status: "success",
    message: `QR reenviado a ${person.name}`,
    name: person.name,
  });
}
