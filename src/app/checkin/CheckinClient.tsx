"use client";

import { useState } from "react";
import { LuCircleCheck, LuInfo, LuTriangleAlert } from "react-icons/lu";
import { Logo } from "@/components/Logo";
import { EVENT } from "@/lib/env";

type State =
  | { kind: "ready"; override?: boolean }
  | { kind: "submitting" }
  | { kind: "done"; name: string }
  | { kind: "already"; name: string }
  | { kind: "error"; message: string };

type Props = {
  token: string;
  email: string;
  name: string;
  initialState: "ready" | "needs-override" | "already";
};

type IconType = React.ComponentType<{ className?: string }>;

export default function CheckinClient({ token, email, name, initialState }: Props) {
  const [state, setState] = useState<State>(
    initialState === "already"
      ? { kind: "already", name }
      : { kind: "ready", override: initialState === "needs-override" },
  );

  async function submit() {
    setState({ kind: "submitting" });
    try {
      const override = "override" in state ? state.override : false;
      const res = await fetch("/api/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, override }),
      });
      const data = await res.json();
      if (data.status === "success") setState({ kind: "done", name: data.name || name });
      else if (data.status === "already") setState({ kind: "already", name: data.name || name });
      else setState({ kind: "error", message: data.message || "Error desconocido" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Network error" });
    }
  }

  if (state.kind === "done" || state.kind === "already") {
    const isAlready = state.kind === "already";
    return (
      <Frame
        gradient={isAlready ? "from-amber-500 to-amber-600" : "from-emerald-500 to-emerald-600"}
        Icon={isAlready ? LuInfo : LuCircleCheck}
        title={isAlready ? "Ya hizo check-in" : `¡Bienvenido${state.name ? ", " : ""}${state.name}!`}
        body={
          isAlready
            ? `${state.name} ya había sido registrado previamente.`
            : "Su asistencia ha sido registrada. Puede pasar."
        }
      />
    );
  }

  if (state.kind === "error") {
    return (
      <Frame
        gradient="from-zinc-600 to-zinc-700"
        Icon={LuTriangleAlert}
        title="Error"
        body={state.message}
        action={
          <button
            onClick={() => setState({ kind: "ready" })}
            className="w-full mt-4 py-4 bg-[var(--color-primary)] text-white rounded-xl font-semibold"
          >
            Reintentar
          </button>
        }
      />
    );
  }

  const needsOverride = state.kind === "ready" && state.override === true;
  const submitting = state.kind === "submitting";

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] overflow-hidden">
        <div
          className={`bg-gradient-to-br ${needsOverride ? "from-amber-500 to-amber-600" : "from-[var(--color-primary)] to-[var(--color-secondary)]"} p-6 text-white`}
        >
          <div className="flex items-center gap-3 mb-1">
            <Logo variant="card" />
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide opacity-90">Check-in</div>
              <div className="font-bold leading-tight truncate">{EVENT.name}</div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="text-center mb-6">
            <div className="text-xs uppercase tracking-wide text-[var(--muted)] mb-1">
              Invitado
            </div>
            <div className="text-2xl font-bold leading-tight">{name}</div>
            <div className="text-sm text-[var(--muted)] mt-1 break-all">{email}</div>
          </div>

          {needsOverride && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 mb-4 text-sm flex items-start gap-2.5">
              <LuTriangleAlert className="size-5 shrink-0 mt-0.5" />
              <div>
                Este invitado <strong>no había confirmado</strong> su asistencia. ¿Permitir
                entrada de todos modos?
              </div>
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full py-5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] disabled:opacity-60 text-white text-lg font-bold rounded-2xl shadow-[0_6px_20px_rgba(210,11,17,0.25)] active:scale-[0.98] transition"
          >
            {submitting
              ? "Registrando…"
              : needsOverride
                ? "Permitir entrada"
                : "Confirmar asistencia"}
          </button>

          <p className="mt-4 text-center text-xs text-[var(--muted)]">
            {EVENT.date} · {EVENT.location.split(",")[0]}
          </p>
        </div>
      </div>
    </main>
  );
}

function Frame({
  gradient,
  Icon,
  title,
  body,
  action,
}: {
  gradient: string;
  Icon: IconType;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg)]">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-[0_8px_28px_rgba(0,0,0,0.08)] overflow-hidden">
        <div className={`bg-gradient-to-br ${gradient} p-10 text-white text-center`}>
          <Icon className="size-16 mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
        <div className="p-8 text-center">
          <p className="text-[15px] leading-relaxed text-[var(--text)]">{body}</p>
          {action}
        </div>
      </div>
    </main>
  );
}
