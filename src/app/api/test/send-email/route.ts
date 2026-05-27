/**
 * TEMPORARY — endpoint de pruebas para previsualizar los 3 correos del sistema.
 * Borrar este archivo (y el panel del dashboard) cuando los diseños queden aprobados.
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import {
  sendConfirmationEmail,
  sendDeclinedEmail,
  sendQrEmail,
  type SendResult,
} from "@/lib/email";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";

const log = logger("test/send-email");

const Body = z.object({
  kind: z.enum(["qr", "confirmation", "declined"]),
  email: z.email().transform((s) => s.toLowerCase().trim()),
  name: z.string().trim().min(1).max(80).optional(),
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
    return Response.json(
      { status: "error", message: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { kind, email, name = "Invitado de prueba" } = parsed.data;
  log.info("incoming", { kind, email, name });

  let result: SendResult;
  if (kind === "qr") result = await sendQrEmail(email, name);
  else if (kind === "confirmation") result = await sendConfirmationEmail(email, name);
  else result = await sendDeclinedEmail(email, name);

  if (!result.ok) {
    log.error("send failed", { kind, email, error: result.error });
    return Response.json(
      { status: "error", message: result.error, kind },
      { status: 502 },
    );
  }

  log.info("send ok", { kind, email, id: result.id });
  return Response.json({
    status: "success",
    message: `Correo "${kind}" enviado a ${email}`,
    id: result.id,
    kind,
  });
}
