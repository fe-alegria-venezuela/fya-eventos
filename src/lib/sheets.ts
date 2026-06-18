import { JWT } from "google-auth-library";
import { env } from "./env";
import { logger } from "./log";

const log = logger("sheets");

// Service-account JWT, created once and reused. getAccessToken() caches + refreshes
// the bearer token internally.
let jwt: JWT | null = null;
function client(): JWT {
  if (!jwt) {
    jwt = new JWT({
      email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL(),
      key: env.GOOGLE_PRIVATE_KEY(),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return jwt;
}

export interface CheckinRow {
  email: string;
  name: string;
  phone?: string;
  detail?: string;
}

// Appends a check-in row to the Google Sheet. Columns:
//   Fecha y hora | Email | Nombre | Teléfono | Acción | Detalle
// Teléfono se deja vacío para que el equipo lo complete a mano el día del evento.
//
// BEST-EFFORT: never throws. The caller logs the result but a Sheets failure must
// NOT block a check-in — Mongo is the source of truth.
export async function appendCheckin(row: CheckinRow): Promise<{ ok: boolean; error?: string }> {
  try {
    const sheetId = env.GOOGLE_SHEETS_ID();
    const tab = env.GOOGLE_SHEETS_TAB();
    const { token } = await client().getAccessToken();
    if (!token) return { ok: false, error: "Sin access token de Google" };

    const range = encodeURIComponent(`${tab}!A:F`);
    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const values = [
      [
        new Date().toISOString(),
        row.email,
        row.name,
        row.phone ?? "",
        "Check-in",
        row.detail ?? "Asistió al evento",
      ],
    ];

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error("append non-2xx", { status: res.status, body: body.slice(0, 300) });
      return { ok: false, error: `Sheets ${res.status}` };
    }

    log.info("check-in appended", { email: row.email });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("append threw", { message });
    return { ok: false, error: message };
  }
}
