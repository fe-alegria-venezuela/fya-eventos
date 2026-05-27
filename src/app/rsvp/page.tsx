import Image from "next/image";
import {
  LuTriangleAlert,
  LuCalendar,
  LuClock,
  LuMapPin,
} from "react-icons/lu";
import { EVENT } from "@/lib/env";

type Status = "success" | "declined" | "error" | "not-found";

function isStatus(s: string | undefined): s is Status {
  return s === "success" || s === "declined" || s === "error" || s === "not-found";
}

export default async function RsvpPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; name?: string; e?: string }>;
}) {
  const sp = await searchParams;
  const status: Status = isStatus(sp.status) ? sp.status : "error";
  const name = sp.name?.trim() || "";
  const email = sp.e?.trim().toLowerCase() || "";

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] overflow-hidden">
        <Cintillo />
        <HeaderTitle status={status} />
        <div className="px-6 pt-6 pb-3 text-[var(--text)]">
          {status === "success" && <SuccessBody name={name} />}
          {status === "declined" && <DeclinedBody name={name} email={email} />}
          {status === "not-found" && <ErrorBody body="El correo del enlace no aparece en nuestra audiencia de invitados. Si crees que es un error, escríbenos." />}
          {status === "error" && <ErrorBody body="No pudimos procesar tu respuesta. Intenta de nuevo en unos minutos o contáctanos." />}
        </div>
        <Footer status={status} />
      </div>
    </main>
  );
}

function Cintillo() {
  return (
    <div className="bg-white">
      <Image
        src="/cintillo.png"
        alt="Fe y Alegría Venezuela · Farmatodo · Cinesa"
        width={2000}
        height={400}
        priority
        className="block w-full h-auto"
      />
    </div>
  );
}

function HeaderTitle({ status }: { status: Status }) {
  const gradient =
    status === "not-found" || status === "error"
      ? "from-zinc-600 to-zinc-700"
      : "from-[var(--color-primary)] to-[var(--color-accent)]";

  const title: Record<Status, string> = {
    success: "¡Recibimos tu confirmación!",
    declined: "¡Gracias por avisarnos!",
    "not-found": "No te encontramos en la lista",
    error: "Algo salió mal",
  };

  return (
    <div className={`bg-gradient-to-br ${gradient} px-5 py-6 text-white text-center`}>
      {(status === "not-found" || status === "error") && (
        <LuTriangleAlert className="size-10 mx-auto mb-2" />
      )}
      <h1 className="text-2xl font-bold leading-tight">{title[status]}</h1>
    </div>
  );
}

function EventInfoBlock() {
  return (
    <div className="bg-[var(--color-pale)] rounded-2xl p-4 space-y-2 text-sm">
      <div className="font-semibold text-[var(--color-primary-dark)]">{EVENT.name}</div>
      <div className="flex items-start gap-2 text-[var(--text)]">
        <LuCalendar className="size-4 shrink-0 mt-0.5 text-[var(--color-primary)]" />
        <span><strong className="font-semibold">Fecha:</strong> {EVENT.date}</span>
      </div>
      <div className="flex items-start gap-2 text-[var(--text)]">
        <LuClock className="size-4 shrink-0 mt-0.5 text-[var(--color-primary)]" />
        <span><strong className="font-semibold">Hora:</strong> {EVENT.hour}</span>
      </div>
      <div className="flex items-start gap-2 text-[var(--text)]">
        <LuMapPin className="size-4 shrink-0 mt-0.5 text-[var(--color-primary)]" />
        <span><strong className="font-semibold">Lugar:</strong> {EVENT.location}</span>
      </div>
    </div>
  );
}

function SuccessBody({ name }: { name: string }) {
  return (
    <>
      <h2 className="text-xl font-bold text-[var(--color-primary)] leading-tight mb-3">
        ¡Gracias{name ? `, ${name}` : ""}!
      </h2>
      <p className="text-[15px] leading-relaxed text-zinc-600 mb-5">
        Te enviamos un correo con tu <strong>código QR personal</strong>, que debes presentar a la
        hora de ingresar al evento.
      </p>

      <EventInfoBlock />

      <div className="mt-5 bg-[#e8f4fd] text-[#0c5a8a] rounded-2xl p-4 text-[13px] leading-relaxed">
        Si no recibes tu QR en los próximos minutos, revisa la carpeta de spam o respóndenos al
        correo de invitación para reenviarlo.
      </div>

      <p className="mt-5 text-center text-xs text-[var(--muted)]">¡Te esperamos!</p>
    </>
  );
}

function DeclinedBody({ name, email }: { name: string; email: string }) {
  const changeMindHref = email
    ? `/api/rsvp?r=yes&e=${encodeURIComponent(email)}`
    : null;

  return (
    <>
      <h2 className="text-xl font-bold text-[var(--color-primary)] leading-tight mb-3">
        Hola{name ? `, ${name}` : ""}.
      </h2>
      <p className="text-[15px] leading-relaxed text-zinc-600 mb-4">
        Hemos registrado que no podrás acompañarnos en <strong>{EVENT.name}</strong>. Lamentamos
        no verte en esta ocasión y agradecemos que nos hayas avisado.
      </p>
      <p className="text-[15px] leading-relaxed text-zinc-600 mb-5">
        Esperamos contar con tu presencia en futuras actividades de {EVENT.organizer}.
      </p>

      <EventInfoBlock />

      {changeMindHref && (
        <p className="mt-5 text-center text-[13px] text-[var(--muted)] leading-relaxed">
          ¿Cambiaste de opinión?{" "}
          <a
            href={changeMindHref}
            className="text-[var(--color-primary)] font-semibold no-underline hover:underline"
          >
            Aún puedes confirmar tu asistencia
          </a>
        </p>
      )}
    </>
  );
}

function ErrorBody({ body }: { body: string }) {
  return <p className="text-[15px] leading-relaxed text-zinc-600">{body}</p>;
}

function Footer({ status }: { status: Status }) {
  const line =
    status === "success"
      ? "¡Nos vemos pronto!"
      : status === "declined"
        ? "Hasta una próxima oportunidad"
        : null;

  return (
    <div className="px-6 py-4 bg-[#fafafa] border-t border-[var(--border)] text-center text-xs text-[var(--muted)]">
      {line && <p className="mb-1.5">{line}</p>}
      <p>
        <strong>{EVENT.organizer}</strong>
      </p>
    </div>
  );
}
