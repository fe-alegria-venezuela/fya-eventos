import { env, EVENT } from "./env";
import { generateToken, encodeEmail } from "./token";
import { logger, mask } from "./log";

const log = logger("email");

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

const COLOR_PRIMARY = "#d20b11";
const COLOR_ACCENT = "#e37152";
const COLOR_PALE = "#f8d6c8";
const COLOR_MUTED_BG = "#fafafa";

// ── URL builders ─────────────────────────────────────────────────────────────

function qrImageUrl(email: string): string {
  const token = generateToken(email);
  const encoded = encodeEmail(email);
  const checkinUrl = `${env.BASE_URL()}/checkin?t=${token}&e=${encoded}`;
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(checkinUrl)}&size=400x400&margin=10`;
}

function cancelUrl(email: string): string {
  return `${env.BASE_URL()}/api/rsvp?r=no&e=${encodeURIComponent(email)}`;
}

function rsvpYesUrl(email: string): string {
  return `${env.BASE_URL()}/api/rsvp?r=yes&e=${encodeURIComponent(email)}`;
}

// Cintillo institucional con auspiciantes (Fe y Alegría + Farmatodo + Cinesa).
// Va edge-to-edge en la parte superior del correo.
function cintilloForEmail(): string {
  const explicit = process.env.NEXT_PUBLIC_EMAIL_CINTILLO_URL;
  if (explicit?.startsWith("http")) return explicit;
  const base = env.BASE_URL().replace(/\/+$/, "");
  return `${base}/cintillo.png`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}

function parseSender(fromEmail: string): { email: string; name: string } {
  const m = fromEmail.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^["']|["']$/g, "").trim(), email: m[2].trim() };
  return { email: fromEmail.trim(), name: EVENT.organizer };
}

// ── Shared shell + reusable blocks ───────────────────────────────────────────

interface ShellOpts {
  preheader: string;
  headerGradient: [string, string]; // [from, to]
  headerTitle: string;
  // headerSubtitle: string;
  bodyHtml: string;
  footerLine?: string;
}

// Mobile-first email layout. Outer table works around Outlook quirks; everything inside
// uses width:100% with max-width caps. Padding stays small (16-20px) so the QR fits on a
// 320px viewport (the narrowest realistic mobile width).
function renderShell(o: ShellOpts): string {
  const cintillo = cintilloForEmail();
  const [g1, g2] = o.headerGradient;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(o.headerTitle)}</title>
</head>
<body style="margin:0;padding:0;background:#faf7f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}</span>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf7f5;padding:16px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);">

          <tr>
            <td style="padding:0;background:#ffffff;line-height:0;font-size:0;">
              <img src="${cintillo}" alt="Fe y Alegría Venezuela · Farmatodo · Cinesa" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
            </td>
          </tr>

          <tr>
            <td style="background:linear-gradient(135deg,${g1} 0%,${g2} 100%);padding:22px 20px;text-align:center;color:#ffffff;">
              <h1 style="margin:0;font-size:24px;font-weight:700;line-height:1.25;">${escapeHtml(o.headerTitle)}</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 20px;color:#1d1d1f;">${o.bodyHtml}</td>
          </tr>

          <tr>
            <td style="padding:16px 20px;background:${COLOR_MUTED_BG};border-top:1px solid #eee;text-align:center;color:#888;font-size:12px;line-height:1.5;">
              ${o.footerLine ? `<p style="margin:0 0 6px;">${escapeHtml(o.footerLine)}</p>` : ""}
              <p style="margin:0;"><strong>${escapeHtml(EVENT.organizer)}</strong></p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

function eventInfoBlock(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLOR_PALE};border-radius:12px;margin:0 0 20px;">
    <tr><td style="padding:16px 18px;">
      <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong> ${escapeHtml(EVENT.name)}</strong></p>
      <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong>Fecha:</strong> ${escapeHtml(EVENT.date)}</p>
      <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong>Hora:</strong> ${escapeHtml(EVENT.hour)}</p>
      <p style="margin:4px 0;font-size:14px;color:#333;line-height:1.5;"><strong>Lugar:</strong> ${escapeHtml(EVENT.location)}</p>
    </td></tr>
  </table>`;
}

// ── Email bodies ─────────────────────────────────────────────────────────────

function renderQrBody(email: string, name: string): string {
  return `
    <h2 style="margin:0 0 12px;font-size:20px;color:${COLOR_PRIMARY};line-height:1.3;">¡Gracias, ${escapeHtml(name)}!</h2>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#555;">
      Tenemos tu lugar reservado. Imprime este correo o tómale captura a tu código QR personal — lo necesitarás para entrar al evento.
    </p>

    ${eventInfoBlock()}

    <p style="margin:0 0 12px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1.2px;font-weight:600;text-align:center;">
      Tu código de acceso
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td align="center">
        <img src="${qrImageUrl(email)}" alt="Tu código QR personal" style="width:100%;max-width:280px;height:auto;display:block;margin:0 auto;border:8px solid #ffffff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
      </td></tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff3cd;border-radius:12px;margin:24px 0 0;">
      <tr><td style="padding:14px 16px;color:#856404;font-size:13px;line-height:1.5;">
        <strong>Importante:</strong> presenta este código en la entrada del evento (desde tu celular o impreso). Es único e intransferible.
      </td></tr>
    </table>

    <p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center;line-height:1.5;">
      ¿Cambió tu plan? <a href="${cancelUrl(email)}" style="color:${COLOR_PRIMARY};text-decoration:none;font-weight:600;">Cancelar mi asistencia</a>
    </p>`;
}

function renderConfirmationBody(name: string): string {
  return `
    <h2 style="margin:0 0 12px;font-size:20px;color:${COLOR_PRIMARY};line-height:1.3;">¡Gracias, ${escapeHtml(name)}!</h2>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#555;">
      Te enviamos un correo con tu <strong>código QR personal</strong>, que debes presentar a la hora de ingresar al evento.
    </p>

    ${eventInfoBlock()}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8f4fd;border-radius:12px;margin:0 0 12px;">
      <tr><td style="padding:14px 16px;color:#0c5a8a;font-size:13px;line-height:1.55;">
        Si no recibes tu QR en los próximos minutos, revisa la carpeta de spam o respóndenos al correo de invitación para reenviarlo.
      </td></tr>
    </table>

    <p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center;line-height:1.5;">
      ¡Te esperamos!
    </p>`;
}

function renderDeclinedBody(name: string, email: string): string {
  return `
    <h2 style="margin:0 0 12px;font-size:20px;color:${COLOR_PRIMARY};line-height:1.3;">Hola, ${escapeHtml(name)}.</h2>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#555;">
      Hemos registrado que no podrás acompañarnos en <strong>${escapeHtml(EVENT.name)}</strong>. Lamentamos no verte en esta ocasión y agradecemos que nos hayas avisado.
    </p>
    <p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#555;">
      Esperamos contar con tu presencia en futuras actividades de Fe y Alegría Venezuela.
    </p>

    ${eventInfoBlock()}

    <p style="margin:20px 0 0;font-size:13px;color:#888;text-align:center;line-height:1.55;">
      ¿Cambiaste de opinión? <a href="${rsvpYesUrl(email)}" style="color:${COLOR_PRIMARY};text-decoration:none;font-weight:600;">Aún puedes confirmar tu asistencia</a>
    </p>`;
}

// ── SendGrid wrapper ─────────────────────────────────────────────────────────

export type SendResult = { ok: true; id?: string } | { ok: false; error: string };

async function sendViaSendGrid(opts: {
  to: string;
  subject: string;
  html: string;
  category: string;
  scope: string; // for logs
}): Promise<SendResult> {
  const from = parseSender(env.FROM_EMAIL());

  log.info(`sending ${opts.scope}`, {
    to: opts.to,
    from,
    subject: opts.subject,
    apiKey: mask(env.SENDGRID_API_KEY()),
  });

  const body = {
    personalizations: [{ to: [{ email: opts.to }] }],
    from,
    reply_to: env.REPLY_TO() ? { email: env.REPLY_TO()! } : undefined,
    subject: opts.subject,
    content: [{ type: "text/html", value: opts.html }],
    tracking_settings: {
      click_tracking: { enable: true, enable_text: false },
      open_tracking: { enable: true },
    },
    categories: ["fya-eventos", opts.category],
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
    log.error(`${opts.scope} threw`, { to: opts.to, message });
    return { ok: false, error: message };
  }

  if (res.status === 202) {
    const id = res.headers.get("x-message-id") || undefined;
    log.info(`${opts.scope} queued`, { to: opts.to, id, status: res.status });
    return { ok: true, id };
  }

  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    /* ignore */
  }
  log.error(`${opts.scope} non-202`, { to: opts.to, status: res.status, body: bodyText.slice(0, 600) });
  return { ok: false, error: `SendGrid ${res.status}: ${bodyText.slice(0, 200) || "no body"}` };
}

// ── Public senders ───────────────────────────────────────────────────────────

export async function sendQrEmail(email: string, name: string): Promise<SendResult> {
  const html = renderShell({
    preheader: `Tu pase de acceso a ${EVENT.name} — guárdalo, lo necesitarás en la entrada.`,
    headerGradient: [COLOR_PRIMARY, COLOR_ACCENT],
    headerTitle: "¡Confirmado!",
    // headerSubtitle: "Aquí está tu pase de acceso",
    bodyHtml: renderQrBody(email, name),
    footerLine: "¡Nos vemos pronto!",
  });
  return sendViaSendGrid({
    to: email,
    subject: `Te esperamos en ${EVENT.name} — tu código QR personal está aquí`,
    html,
    category: "qr-confirmation",
    scope: "QR email",
  });
}

export async function sendConfirmationEmail(email: string, name: string): Promise<SendResult> {
  const html = renderShell({
    preheader: `Recibimos tu confirmación. En breve te enviamos tu código QR.`,
    headerGradient: [COLOR_PRIMARY, COLOR_ACCENT],
    headerTitle: "¡Recibimos tu confirmación!",
    // headerSubtitle: "Enviamos un QR a tu correo",
    bodyHtml: renderConfirmationBody(name),
    footerLine: "¡Nos vemos pronto!",
  });
  return sendViaSendGrid({
    to: email,
    subject: `Recibimos tu confirmación · ${EVENT.name}`,
    html,
    category: "rsvp-confirmation",
    scope: "Confirmation email",
  });
}

export async function sendDeclinedEmail(email: string, name: string): Promise<SendResult> {
  const html = renderShell({
    preheader: `Gracias por avisarnos que no podrás acompañarnos.`,
    headerGradient: [COLOR_PRIMARY, COLOR_ACCENT],
    headerTitle: "¡Gracias por avisarnos!",
    // headerSubtitle: "Lamentamos no verte esta vez",
    bodyHtml: renderDeclinedBody(name, email),
    footerLine: "Hasta una próxima oportunidad",
  });
  return sendViaSendGrid({
    to: email,
    subject: `Lamentamos no verte en ${EVENT.name}`,
    html,
    category: "rsvp-declined",
    scope: "Declined email",
  });
}
