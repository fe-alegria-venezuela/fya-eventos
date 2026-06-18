import { NextRequest } from "next/server";
import { syncFromMailchimp } from "@/lib/sync";
import { env } from "@/lib/env";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// La sync pagina Mailchimp; dale aire (Vercel Pro permite hasta 300s).
export const maxDuration = 120;

const log = logger("api/sync");

async function runSync(force: boolean) {
  try {
    const result = await syncFromMailchimp({ force });
    return Response.json({
      status: result.skipped ? "skipped" : "success",
      message: result.skipped
        ? "Ya se sincronizó hace un momento"
        : `Sincronizado: ${result.added} nuevos, ${result.updated} actualizados · ${result.total} en Mailchimp`,
      added: result.added,
      updated: result.updated,
      total: result.total,
      at: result.at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    log.error("sync failed", { message });
    return Response.json({ status: "error", message }, { status: 502 });
  }
}

// Cron de Vercel. Vercel inyecta "Authorization: Bearer ${CRON_SECRET}".
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET()}`) {
    log.warn("unauthorized cron call");
    return Response.json({ status: "error", message: "No autorizado" }, { status: 401 });
  }
  log.info("cron sync triggered");
  return runSync(true);
}

// Botón "Sincronizar" del dashboard. Sin secreto (panel del operador), pero con
// debounce server-side para no martillar Mailchimp.
export async function POST() {
  log.info("manual sync triggered");
  return runSync(false);
}
