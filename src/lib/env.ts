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
};

export const TAGS = {
  INVITADO: "Invitado",
  CONFIRMED: "Sí asistirá",
  DECLINED: "No asistirá",
  CHECKIN: "Asistio",
} as const;

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
