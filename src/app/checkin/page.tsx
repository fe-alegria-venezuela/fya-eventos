import { LuTriangleAlert } from "react-icons/lu";
import { decodeEmail, verifyToken } from "@/lib/token";
import { getOrImportInvitee } from "@/lib/invitees";
import CheckinClient from "./CheckinClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] overflow-hidden">
        <div className="bg-gradient-to-br from-zinc-600 to-zinc-700 p-10 text-white text-center">
          <LuTriangleAlert className="size-16 mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        <div className="p-8 text-center">
          <p className="text-[15px] leading-relaxed text-[var(--text)]">{body}</p>
        </div>
      </div>
    </main>
  );
}

export default async function CheckinPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; e?: string }>;
}) {
  const { t, e } = await searchParams;

  if (!t || !e) {
    return <ErrorScreen title="QR inválido" body="El enlace no contiene los datos necesarios." />;
  }

  const email = decodeEmail(e);
  if (!email || !verifyToken(t, email)) {
    return (
      <ErrorScreen
        title="QR no reconocido"
        body="No pudimos validar este código. Verifique con el equipo de la entrada."
      />
    );
  }

  const person = await getOrImportInvitee(email);
  if (!person) {
    return (
      <ErrorScreen
        title="Invitado no encontrado"
        body="Este correo no aparece en nuestra audiencia. Revise con el equipo de la entrada."
      />
    );
  }

  const initial = person.hasCheckedIn
    ? "already"
    : !person.hasConfirmed
      ? "needs-override"
      : "ready";

  return (
    <CheckinClient token={t} email={person.email} name={person.name} initialState={initial} />
  );
}
