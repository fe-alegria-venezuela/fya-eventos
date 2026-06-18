import { NextRequest } from "next/server";
import { appendCheckin } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const result = await appendCheckin({
      email: "test-sheets@feyalegria.org",
      name: "Invitado de Prueba (AI Assistant)",
      detail: "Prueba de conexión exitosa",
    });

    if (result.ok) {
      return Response.json({
        status: "success",
        message: "¡Conexión exitosa! Se agregó la fila de prueba a Google Sheets.",
      });
    } else {
      return Response.json(
        {
          status: "error",
          message: "No se pudo escribir en la hoja.",
          error: result.error,
        },
        { status: 500 }
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        status: "error",
        message: "Excepción en el endpoint de prueba.",
        error: msg,
      },
      { status: 500 }
    );
  }
}
