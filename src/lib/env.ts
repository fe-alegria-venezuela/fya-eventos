function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  MAILCHIMP_API_KEY: () => required("MAILCHIMP_API_KEY"),
  MAILCHIMP_SERVER: () => process.env.MAILCHIMP_SERVER || "us22",
  MAILCHIMP_LIST_ID: () => process.env.MAILCHIMP_LIST_ID || "30d2b6eb3d",
  QR_SECRET: () => required("QR_SECRET"),
  BASE_URL: () =>
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  SENDGRID_API_KEY: () => required("SENDGRID_API_KEY"),
  // Sender. Must be a verified sender in your SendGrid account (Single Sender Verification
  // or a domain you authenticated). Format: "Display Name <email@domain.com>".
  FROM_EMAIL: () => required("FROM_EMAIL"),
  REPLY_TO: () => process.env.REPLY_TO_EMAIL,

  // ── MongoDB (source of truth for invitees + their statuses) ──────────────────
  MONGODB_URI: () => required("MONGODB_URI"),
  MONGODB_DB: () => process.env.MONGODB_DB || "fya-eventos",

  // ── Google Sheets (check-in log + datos extra que se cargan el día del evento) ─
  // Service account con la Sheets API habilitada. El Sheet debe estar COMPARTIDO
  // con el email del service account (rol Editor).
  GOOGLE_SERVICE_ACCOUNT_EMAIL: () => required("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
  // La private key suele venir con saltos de línea escapados como "\n" en el env.
  GOOGLE_PRIVATE_KEY: () => required("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
  GOOGLE_SHEETS_ID: () => required("GOOGLE_SHEETS_ID"),
  GOOGLE_SHEETS_TAB: () => process.env.GOOGLE_SHEETS_TAB || "Check-ins",

  // ── Cron / sync ──────────────────────────────────────────────────────────────
  // Vercel inyecta "Authorization: Bearer ${CRON_SECRET}" en los requests del cron.
  CRON_SECRET: () => required("CRON_SECRET"),
};

export const TAGS = {
  INVITADO: "Invitado",
  CONFIRMED: "Sí asistirá",
  DECLINED: "No asistirá",
  CHECKIN: "Asistio",
} as const;

// Optional pre-known segment IDs. When set, we skip the /segments?type=… discovery call
// entirely — useful to dodge Akamai when the segments listing endpoint is blocked.
// Get the IDs from the dashboard logs ("segment found {...,id:XXXXX}") or from Mailchimp UI.
function parseEnvInt(name: string): number | null {
  const v = process.env[name];
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export const SEGMENT_ID_OVERRIDES: Record<string, number | null> = {
  [TAGS.INVITADO]: parseEnvInt("MAILCHIMP_SEGMENT_INVITADO"),
  [TAGS.CONFIRMED]: parseEnvInt("MAILCHIMP_SEGMENT_CONFIRMED"),
  [TAGS.DECLINED]: parseEnvInt("MAILCHIMP_SEGMENT_DECLINED"),
};

export const EVENT = {
  name: process.env.NEXT_PUBLIC_EVENT_NAME || "Evento Trasnocho Cultural",
  date: process.env.NEXT_PUBLIC_EVENT_DATE || "18 de junio, 2026",
  hour: process.env.NEXT_PUBLIC_EVENT_HOUR || "6:00 pm",
  location:
    process.env.NEXT_PUBLIC_EVENT_LOCATION ||
    "Trasnocho Cultural, 1060 Avenida Principal de las Mercedes, Caracas",
  organizer: process.env.NEXT_PUBLIC_ORGANIZER || "Fe y Alegría Venezuela",
  logo: process.env.NEXT_PUBLIC_LOGO_URL || "/fya_color_h.png",
};
