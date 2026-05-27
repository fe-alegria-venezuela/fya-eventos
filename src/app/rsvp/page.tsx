import { LuCircleCheck, LuTriangleAlert, LuCalendar, LuMapPin } from "react-icons/lu";
import { Logo } from "@/components/Logo";
import { EVENT } from "@/lib/env";

type Status = "success" | "declined" | "error" | "not-found";
type IconType = React.ComponentType<{ className?: string }>;

const MESSAGES: Record<
  Status,
  { title: string; body: string; tone: "ok" | "warn" | "err"; Icon: IconType }
> = {
  success: {
    title: "¡Gracias por confirmar!",
    body: "Te enviaremos por correo un QR único para tu entrada al evento. Llévalo en el celular o impreso.",
    tone: "ok",
    Icon: LuCircleCheck,
  },
  declined: {
    title: "Gracias por avisarnos",
    body: "Lamentamos que no puedas acompañarnos. Esperamos verte en una próxima ocasión.",
    tone: "warn",
    Icon: LuCircleCheck,
  },
  "not-found": {
    title: "No te encontramos en la lista",
    body: "El correo del enlace no aparece en nuestra audiencia de invitados. Si crees que es un error, escríbenos.",
    tone: "err",
    Icon: LuTriangleAlert,
  },
  error: {
    title: "Algo salió mal",
    body: "No pudimos procesar tu respuesta. Intenta de nuevo en unos minutos o contáctanos.",
    tone: "err",
    Icon: LuTriangleAlert,
  },
};

export default async function RsvpPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; name?: string }>;
}) {
  const { status, name } = await searchParams;
  const key: Status = (["success", "declined", "error", "not-found"] as const).includes(
    status as Status,
  )
    ? (status as Status)
    : "error";
  const m = MESSAGES[key];

  const accent =
    m.tone === "ok"
      ? "from-[var(--color-primary)] to-[var(--color-secondary)]"
      : m.tone === "warn"
        ? "from-[var(--color-accent)] to-[var(--color-soft)]"
        : "from-zinc-600 to-zinc-700";

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] overflow-hidden">
        <div className={`bg-gradient-to-br ${accent} p-8 text-white text-center`}>
          <div className="flex justify-center mb-4">
            <Logo variant="card" />
          </div>
          <m.Icon className="size-12 mx-auto mb-3" />
          <h1 className="text-2xl font-bold leading-tight">
            {name ? `${m.title.replace("!", "")}, ${name}!` : m.title}
          </h1>
        </div>

        <div className="p-8">
          <p className="text-[15px] leading-relaxed text-[var(--text)] mb-6">{m.body}</p>

          {key === "success" && (
            <div className="bg-[var(--color-pale)] rounded-2xl p-5 space-y-2.5 text-sm">
              <div className="font-semibold text-[var(--color-primary-dark)]">{EVENT.name}</div>
              <div className="flex items-start gap-2 text-[var(--text)]">
                <LuCalendar className="size-4 shrink-0 mt-0.5 text-[var(--color-primary)]" />
                <span>{EVENT.date}</span>
              </div>
              <div className="flex items-start gap-2 text-[var(--text)]">
                <LuMapPin className="size-4 shrink-0 mt-0.5 text-[var(--color-primary)]" />
                <span>{EVENT.location}</span>
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-[var(--muted)]">{EVENT.organizer}</p>
        </div>
      </div>
    </main>
  );
}
