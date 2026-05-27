import { env, EVENT } from "./env";
import { generateToken, encodeEmail } from "./token";
import { logger, mask } from "./log";

const log = logger("email");

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

const COLOR_PRIMARY = "#d20b11";
const COLOR_ACCENT = "#e37152";
const COLOR_PALE = "#f8d6c8";

function qrImageUrl(email: string): string {
  const token = generateToken(email);
  const encoded = encodeEmail(email);
  const checkinUrl = `${env.BASE_URL()}/checkin?t=${token}&e=${encoded}`;
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(checkinUrl)}&size=400x400&margin=10`;
}

function cancelUrl(email: string): string {
  return `${env.BASE_URL()}/api/rsvp?r=no&e=${encodeURIComponent(email)}`;
}

function logoForEmail(): string {
  // Email clients fetch images from the public internet, so localhost paths fail.
  // Priority: explicit EMAIL_LOGO_URL → public NEXT_PUBLIC_LOGO_URL (if absolute) → BASE_URL + asset.
  const explicit = process.env.NEXT_PUBLIC_EMAIL_LOGO_URL;
  if (explicit?.startsWith("http")) return explicit;
  const configured = process.env.NEXT_PUBLIC_LOGO_URL;
  if (configured?.startsWith("http")) return configured;
  const base = env.BASE_URL().replace(/\/+$/, "");
  return `${base}/fya_color_h.png`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

// Parses "Display Name <email@domain.com>" → { name, email }.
// If only the bare address is provided, falls back to organizer as display name so
// Gmail doesn't show just the local-part (e.g. "a.restrepo") as the sender.
function parseSender(fromEmail: string): { email: string; name: string } {
  const m = fromEmail.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^["']|["']$/g, "").trim(), email: m[2].trim() };
  return { email: fromEmail.trim(), name: EVENT.organizer };
}

function renderHtml(email: string, name: string): string {
  const qrUrl = qrImageUrl(email);
  const cancel = cancelUrl(email);
  const logo = logoForEmail();
  const preheader = `Tu pase de acceso a ${EVENT.name} — guárdalo, lo necesitarás en la entrada.`;

  // Mobile-first email layout. Outer table works around Outlook quirks; everything inside
  // uses width:100% with max-width caps. Padding stays small (16px) so the QR fits on a
  // 320px viewport (the narrowest realistic mobile width).
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>Tu pase de acceso</title>
</head>
<body style="margin:0;padding:0;background:#faf7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f5;padding:16px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:linear-gradient(135deg,${COLOR_PRIMARY} 0%,${COLOR_ACCENT} 100%);padding:28px 20px;text-align:center;color:#ffffff;">
              <img src="${logo}" alt="Fe y Alegría Venezuela" style="width:auto;height:48px;max-width:80%;margin:0 auto 16px;display:block;background:#ffffff;padding:8px 14px;border-radius:12px;">
              <h1 style="margin:0;font-size:24px;font-weight:700;line-height:1.25;">¡Confirmado!</h1>
              <p style="margin:8px 0 0;font-size:14px;opacity:0.95;line-height:1.4;">Aquí está tu pase de acceso</p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 20px;color:#1d1d1f;">

              <h2 style="margin:0 0 12px;font-size:20px;color:${COLOR_PRIMARY};line-height:1.3;">¡Gracias, ${escapeHtml(name)}!</h2>
              <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#555;">
                Tenemos tu lugar reservado. Guarda este correo o tómale captura al código QR — lo necesitarás para entrar al evento.
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR_PALE};border-radius:12px;margin:0 0 20px;">
                <tr><td style="padding:16px 18px;">
                  <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong>Evento:</strong> ${escapeHtml(EVENT.name)}</p>
                  <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong>Fecha:</strong> ${escapeHtml(EVENT.date)}</p>
                  <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong>Lugar:</strong> ${escapeHtml(EVENT.location)}</p>
                </td></tr>
              </table>

              <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;text-align:center;">
                Tu código de acceso
              </p>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center">
                  <img src="${qrUrl}" alt="Tu código QR personal" style="width:100%;max-width:280px;height:auto;display:block;margin:0 auto;border:8px solid #ffffff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
                </td></tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff3cd;border-radius:12px;margin:24px 0 0;">
                <tr><td style="padding:14px 16px;color:#856404;font-size:13px;line-height:1.5;">
                  <strong>Importante:</strong> presenta este código en la entrada (en tu celular o impreso). Es único e intransferible.
                </td></tr>
              </table>

              <p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center;line-height:1.5;">
                ¿Cambió tu plan? <a href="${cancel}" style="color:${COLOR_PRIMARY};text-decoration:none;font-weight:600;">Cancelar mi asistencia</a>
              </p>

            </td>
          </tr>

          <tr>
            <td style="padding:16px 20px;background:#fafafa;border-top:1px solid #eee;text-align:center;color:#888;font-size:12px;line-height:1.5;">
              <p style="margin:0;">¡Nos vemos pronto!</p>
              <p style="margin:6px 0 0;"><strong>${escapeHtml(EVENT.organizer)}</strong></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

export async function sendQrEmail(email: string, name: string): Promise<SendResult> {
  const from = parseSender(env.FROM_EMAIL());
  const subject = `Te esperamos con mucho entusiasmo en ${EVENT.name} — tu pase está adentro`;

  log.info("sending QR email", {
    to: email,
    name,
    from,
    apiKey: mask(env.SENDGRID_API_KEY()),
  });

  const body = {
    personalizations: [{ to: [{ email }] }],
    from,
    reply_to: env.REPLY_TO() ? { email: env.REPLY_TO()! } : undefined,
    subject,
    content: [{ type: "text/html", value: renderHtml(email, name) }],
    tracking_settings: {
      // Click tracking rewrites the cancel link — keep it on but skip for the QR image.
      click_tracking: { enable: true, enable_text: false },
      open_tracking: { enable: true },
    },
    categories: ["fya-eventos", "qr-confirmation"],
  };

  let res: Response;
  try {
    res = await fetch(SENDGRID_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.SENDGRID_API_KEY()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("send threw", { to: email, message });
    return { ok: false, error: message };
  }

  // SendGrid returns 202 Accepted on success with empty body and X-Message-Id header.
  if (res.status === 202) {
    const id = res.headers.get("x-message-id") || undefined;
    log.info("QR email queued", { to: email, id, status: res.status });
    return { ok: true, id };
  }

  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    // ignore
  }
  log.error("SendGrid non-202", { to: email, status: res.status, body: bodyText.slice(0, 600) });
  return { ok: false, error: `SendGrid ${res.status}: ${bodyText.slice(0, 200) || "no body"}` };
}
