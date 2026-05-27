"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuUsers,
  LuPartyPopper,
  LuRefreshCw,
  LuSearch,
  LuCircleCheck,
  LuClock,
  LuCircleX,
  LuCalendar,
  LuMapPin,
  LuCamera,
  LuQrCode,
  LuCircleHelp,
  LuTicket,
  LuCheck,
  LuMail,
  LuChevronDown,
  LuFlaskConical,
  LuSend,
} from "react-icons/lu";
import { Logo } from "@/components/Logo";
import { EVENT } from "@/lib/env";
import type { DashboardData, Person } from "@/lib/mailchimp";

type Tab = "invitados" | "evento";
type Toast = { msg: string; tone: "ok" | "info" | "err" } | null;

export default function DashboardClient({ initialData }: { initialData: DashboardData | null }) {
  const [data, setData] = useState<DashboardData | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("invitados");
  const [search, setSearch] = useState("");
  const [openCard, setOpenCard] = useState<"confirmed" | "noresp" | "declined">("confirmed");
  const [modalOpen, setModalOpen] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [lastUpdate, setLastUpdate] = useState<string>(
    initialData ? new Date(initialData.timestamp).toLocaleTimeString("es-VE") : "—",
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, tone: "ok" | "info" | "err" = "info") => {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const d = (await res.json()) as DashboardData;
      setData(d);
      setLastUpdate(new Date(d.timestamp).toLocaleTimeString("es-VE"));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Error al actualizar", "err");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const id = setInterval(refresh, 25_000);
    const onVis = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  async function manualCheckIn(email: string) {
    const res = await fetch("/api/invitados/manual-checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const r = await res.json();
    const tone = r.status === "success" ? "ok" : r.status === "already" ? "info" : "err";
    showToast(r.message, tone);
    if (r.status === "success") refresh();
    return r.status;
  }

  async function resendQr(email: string) {
    showToast("Reenviando QR…", "info");
    const res = await fetch("/api/invitados/reenviar-qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const r = await res.json();
    showToast(r.message, r.status === "success" ? "ok" : "err");
    if (r.status === "success") setTimeout(refresh, 1500);
  }

  function filterPeople(list: Person[]): Person[] {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q),
    );
  }

  const s = data?.stats;

  return (
    <div className="min-h-screen pb-24">
      <Header onRefresh={refresh} loading={loading} lastUpdate={lastUpdate} />

      <div className="max-w-3xl mx-auto px-4">
        <nav className="flex gap-1.5 bg-white p-1.5 rounded-2xl mb-4 shadow-sm">
          {(
            [
              { id: "invitados" as const, label: "Invitados", Icon: LuUsers },
              { id: "evento" as const, label: "Evento", Icon: LuPartyPopper },
            ]
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex-1 py-3 px-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition ${
                tab === id
                  ? "bg-[var(--color-primary)] text-white shadow-[0_2px_6px_rgba(210,11,17,0.3)]"
                  : "text-[var(--muted)]"
              }`}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>

        {tab === "invitados" && (
          <section>
            <Stats
              cells={[
                { label: "Confirmados", value: s?.confirmed, accent: "primary" },
                { label: "Por responder", value: s?.noResponse, accent: "warning" },
                { label: "No asisten", value: s?.declined, accent: "muted" },
                { label: "Total invitados", value: s?.totalInvited, accent: "primary" },
              ]}
            />

            <div className="relative mb-3">
              <LuSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-[var(--muted)] pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar invitado…"
                className="w-full pl-10 pr-4 py-3 bg-white border border-[var(--border)] rounded-xl text-base focus:outline-2 focus:outline-[var(--color-primary)]"
              />
            </div>

            <ListCard
              id="confirmed"
              title="Confirmaron asistencia"
              Icon={LuCircleCheck}
              count={data?.confirmed.length ?? 0}
              open={openCard === "confirmed"}
              onToggle={() =>
                setOpenCard(openCard === "confirmed" ? "noresp" : "confirmed")
              }
            >
              <PeopleRows
                people={filterPeople(data?.confirmed ?? [])}
                emptyText="Nadie ha confirmado todavía"
                actionFor={(p) =>
                  p.hasCheckedIn ? (
                    <span className="text-xs text-[var(--success)] font-semibold whitespace-nowrap inline-flex items-center gap-1">
                      <LuCheck className="size-3.5" />
                      Asistió
                    </span>
                  ) : (
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => resendQr(p.email)}
                        aria-label="Reenviar QR"
                        title="Reenviar QR"
                        className="p-2 bg-[var(--color-pale)] text-[var(--color-primary-dark)] rounded-lg"
                      >
                        <LuMail className="size-4" />
                      </button>
                      <button
                        onClick={() => manualCheckIn(p.email)}
                        className="px-3 py-2 bg-[var(--color-primary)] text-white text-xs font-semibold rounded-lg whitespace-nowrap"
                      >
                        Marcar llegada
                      </button>
                    </div>
                  )
                }
              />
            </ListCard>

            <ListCard
              id="noresp"
              title="Aún no responden"
              Icon={LuClock}
              count={data?.noResponse.length ?? 0}
              open={openCard === "noresp"}
              onToggle={() => setOpenCard(openCard === "noresp" ? "confirmed" : "noresp")}
            >
              <PeopleRows
                people={filterPeople(data?.noResponse ?? [])}
                emptyText="Sin pendientes"
                dot="unknown"
              />
            </ListCard>

            <ListCard
              id="declined"
              title="No podrán asistir"
              Icon={LuCircleX}
              count={data?.declined.length ?? 0}
              open={openCard === "declined"}
              onToggle={() => setOpenCard(openCard === "declined" ? "confirmed" : "declined")}
            >
              <PeopleRows
                people={filterPeople(data?.declined ?? [])}
                emptyText="Nadie ha declinado"
                dot="declined"
              />
            </ListCard>
          </section>
        )}

        {tab === "evento" && (
          <section>
            <div className="bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-accent)] text-white rounded-3xl p-7 mb-4 shadow-[0_8px_24px_rgba(210,11,17,0.25)]">
              <h2 className="text-xl font-bold mb-2">¿Es el día del evento?</h2>
              <p className="text-sm opacity-95 leading-relaxed mb-5">
                Usa la <strong>cámara nativa</strong> de tu celular (iPhone, Google Lens) para
                escanear el QR de cada invitado. Se abrirá automáticamente la página de
                confirmación.
              </p>
              <div className="flex flex-col gap-2 mb-5 text-sm opacity-95">
                <div className="flex items-center gap-2">
                  <LuCalendar className="size-4 shrink-0" />
                  <span>{EVENT.date}</span>
                </div>
                <div className="flex items-start gap-2">
                  <LuMapPin className="size-4 shrink-0 mt-0.5" />
                  <span>{EVENT.location}</span>
                </div>
              </div>
              <button
                onClick={() =>
                  alert(
                    "Cómo hacer check-in:\n\n" +
                      "1. Pídele al invitado que muestre su QR.\n\n" +
                      "2. Abre la cámara de tu celular y apunta al QR.\n\n" +
                      "3. Toca la notificación con el enlace.\n\n" +
                      "4. Pulsa 'Confirmar asistencia'. Listo.",
                  )
                }
                className="w-full py-4 bg-white text-[var(--color-primary)] rounded-2xl font-bold text-base shadow-md active:scale-[0.98] inline-flex items-center justify-center gap-2"
              >
                <LuCamera className="size-5" />
                ¿Cómo escanear?
              </button>
            </div>

            <ProgressCard
              arrived={s?.arrived ?? 0}
              total={s?.confirmed ?? 0}
              percent={s?.attendanceRate ?? 0}
            />

            <button
              onClick={() => setModalOpen(true)}
              className="w-full py-5 px-4 bg-white border-2 border-[var(--color-primary)] text-[var(--color-primary)] rounded-2xl text-base font-semibold mb-4 inline-flex items-center justify-center gap-2"
            >
              <LuCircleHelp className="size-5 shrink-0" />
              ¿El invitado no recibió el QR? Regístralo aquí
            </button>

            <Stats
              cells={[
                { label: "Ya llegaron", value: s?.arrived, accent: "success" },
                { label: "Por llegar", value: s?.pending, accent: "warning" },
              ]}
              cols={2}
            />

            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mt-5 mb-2 ml-1">
              Actividad reciente
            </div>
            <ActivityStream confirmed={data?.confirmed ?? []} />

            <EmailTestPanel showToast={showToast} />
          </section>
        )}
      </div>

      {modalOpen && (
        <ManualModal
          email={manualEmail}
          setEmail={setManualEmail}
          onClose={() => {
            setModalOpen(false);
            setManualEmail("");
          }}
          onSubmit={async () => {
            const email = manualEmail.trim().toLowerCase();
            if (!email.includes("@")) {
              showToast("Email inválido", "err");
              return;
            }
            const status = await manualCheckIn(email);
            if (status === "success" || status === "already") {
              setModalOpen(false);
              setManualEmail("");
            }
          }}
          onResend={async () => {
            const email = manualEmail.trim().toLowerCase();
            if (!email.includes("@")) {
              showToast("Email inválido", "err");
              return;
            }
            await resendQr(email);
            setModalOpen(false);
            setManualEmail("");
          }}
        />
      )}

      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3.5 rounded-2xl font-semibold text-sm text-white shadow-xl z-50 max-w-[90%] ${
            toast.tone === "ok"
              ? "bg-[var(--success)]"
              : toast.tone === "err"
                ? "bg-[var(--color-primary)]"
                : "bg-[var(--color-accent)]"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Header({
  onRefresh,
  loading,
  lastUpdate,
}: {
  onRefresh: () => void;
  loading: boolean;
  lastUpdate: string;
}) {
  return (
    <header className="bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-secondary)] text-white px-5 py-6 rounded-b-3xl shadow-[0_4px_14px_rgba(210,11,17,0.2)] mb-5">
      <div className="max-w-3xl mx-auto flex items-center gap-3">
        <Logo variant="header" />
        <div className="flex-1 min-w-0">
          <h1 className="font-bold text-lg leading-tight truncate">{EVENT.name}</h1>
          <small className="text-xs opacity-90 block mt-0.5" suppressHydrationWarning>
            {EVENT.date} · Última actualización {lastUpdate}
          </small>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          aria-label="Actualizar"
          className="w-10 h-10 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center"
        >
          <LuRefreshCw className={`size-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </header>
  );
}

function Stats({
  cells,
  cols = 4,
}: {
  cells: { label: string; value: number | undefined; accent: "primary" | "success" | "warning" | "muted" }[];
  cols?: 2 | 4;
}) {
  const accents: Record<string, string> = {
    primary: "border-[var(--color-primary)]",
    success: "border-[var(--success)]",
    warning: "border-[var(--warning)]",
    muted: "border-[var(--muted)]",
  };
  return (
    <div
      className={`grid gap-2.5 mb-3 ${cols === 2 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4"}`}
    >
      {cells.map((c) => (
        <div
          key={c.label}
          className={`bg-white p-4 rounded-2xl shadow-sm border-l-4 ${accents[c.accent]}`}
        >
          <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] font-semibold">
            {c.label}
          </div>
          <div className="text-3xl font-extrabold mt-1">
            {c.value === undefined ? "—" : c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

type IconType = React.ComponentType<{ className?: string }>;

function ListCard({
  title,
  Icon,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  Icon: IconType;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden mb-3">
      <button
        onClick={onToggle}
        className="w-full flex justify-between items-center px-4 py-3.5 bg-[var(--color-pale)] text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-primary-dark)]">
          <Icon className="size-4" />
          {title}
        </span>
        <div className="flex items-center gap-2.5">
          <span className="bg-[var(--color-primary)] text-white px-2.5 py-0.5 rounded-xl text-xs font-bold">
            {count}
          </span>
          <LuChevronDown
            className={`text-[var(--color-primary)] size-4 transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </div>
      </button>
      {open && <div className="max-h-[400px] overflow-y-auto">{children}</div>}
    </div>
  );
}

function PeopleRows({
  people,
  emptyText,
  dot = "auto",
  actionFor,
}: {
  people: Person[];
  emptyText: string;
  dot?: "auto" | "unknown" | "declined";
  actionFor?: (p: Person) => React.ReactNode;
}) {
  if (people.length === 0) {
    return <div className="py-7 px-4 text-center text-sm text-[var(--muted)]">{emptyText}</div>;
  }
  return (
    <>
      {people.map((p) => {
        const dotColor =
          dot === "unknown"
            ? "bg-gray-300"
            : dot === "declined"
              ? "bg-[var(--muted)]"
              : p.hasCheckedIn
                ? "bg-[var(--success)]"
                : "bg-[var(--warning)]";
        return (
          <div
            key={p.email}
            className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0"
          >
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm truncate">{p.name}</div>
              <div className="text-xs text-[var(--muted)] truncate">{p.email}</div>
            </div>
            {actionFor && <div>{actionFor(p)}</div>}
          </div>
        );
      })}
    </>
  );
}

function ProgressCard({
  arrived,
  total,
  percent,
}: {
  arrived: number;
  total: number;
  percent: number;
}) {
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm mb-3">
      <div className="flex justify-between items-baseline mb-2.5">
        <span className="text-[15px]">
          <strong>Asistencia en vivo:</strong> {arrived} / {total}
        </span>
        <span className="text-2xl font-extrabold text-[var(--color-primary)]">{percent}%</span>
      </div>
      <div className="h-2.5 bg-[var(--color-pale)] rounded-lg overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary)] transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ActivityStream({ confirmed }: { confirmed: Person[] }) {
  const arrived = confirmed
    .filter((p) => p.hasCheckedIn)
    .sort((a, b) => (b.lastChanged ?? "").localeCompare(a.lastChanged ?? ""))
    .slice(0, 15);

  if (arrived.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm">
        <div className="py-7 px-4 text-center text-sm text-[var(--muted)]">Sin actividad aún</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {arrived.map((p) => {
        const time = p.lastChanged
          ? new Date(p.lastChanged).toLocaleTimeString("es-VE", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "";
        return (
          <div
            key={p.email}
            className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] last:border-b-0"
          >
            <div className="w-9 h-9 bg-[var(--color-pale)] rounded-full flex items-center justify-center shrink-0">
              <LuTicket className="size-4 text-[var(--color-primary-dark)]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{p.name}</div>
              <div className="text-xs text-[var(--muted)]">Check-in registrado</div>
            </div>
            <div className="text-xs text-[var(--muted)] shrink-0" suppressHydrationWarning>
              {time}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TEMPORARY — panel para probar los 3 correos del sistema.
// Borrar este componente, su <EmailTestPanel ... /> en el Evento tab,
// los imports LuFlaskConical/LuSend, y el route /api/test/send-email
// cuando los diseños queden aprobados.
// ────────────────────────────────────────────────────────────────────────────
type EmailKind = "qr" | "confirmation" | "declined";

function EmailTestPanel({
  showToast,
}: {
  showToast: (msg: string, tone?: "ok" | "info" | "err") => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<EmailKind | null>(null);

  async function send(kind: EmailKind) {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) {
      showToast("Email inválido", "err");
      return;
    }
    setBusy(kind);
    try {
      const res = await fetch("/api/test/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, email: e, name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (data.status === "success") showToast(data.message, "ok");
      else showToast(data.message || "Falló el envío", "err");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Network error", "err");
    } finally {
      setBusy(null);
    }
  }

  const buttons: { kind: EmailKind; label: string; sub: string }[] = [
    { kind: "confirmation", label: "Confirmación", sub: "RSVP recibido" },
    { kind: "qr", label: "Con QR", sub: "Pase de acceso" },
    { kind: "declined", label: "Declinación", sub: "No asistirá" },
  ];

  return (
    <div className="mt-8 border-2 border-dashed border-amber-400 rounded-2xl bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <LuFlaskConical className="size-4 text-amber-700" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
          Pruebas · provisional
        </span>
      </div>
      <p className="text-xs text-amber-900/80 mb-3 leading-snug">
        Envía cada uno de los 3 correos del sistema al email indicado, sin tocar Mailchimp.
        Útil para revisar diseño. Borrar este panel cuando los correos queden aprobados.
      </p>

      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="correo@destino.com"
        autoComplete="off"
        inputMode="email"
        className="w-full px-3.5 py-2.5 border border-amber-300 bg-white rounded-lg text-sm mb-2 focus:outline-2 focus:outline-amber-500"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nombre (opcional) — default: Invitado de prueba"
        className="w-full px-3.5 py-2.5 border border-amber-300 bg-white rounded-lg text-sm mb-3 focus:outline-2 focus:outline-amber-500"
      />

      <div className="grid grid-cols-3 gap-2">
        {buttons.map((b) => (
          <button
            key={b.kind}
            onClick={() => send(b.kind)}
            disabled={busy !== null}
            className="flex flex-col items-center gap-1 p-3 bg-white hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed border border-amber-300 rounded-lg transition"
          >
            {busy === b.kind ? (
              <LuRefreshCw className="size-4 text-amber-700 animate-spin" />
            ) : (
              <LuSend className="size-4 text-amber-700" />
            )}
            <span className="text-xs font-semibold text-amber-900">{b.label}</span>
            <span className="text-[10px] text-amber-700/80 leading-tight">{b.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ManualModal({
  email,
  setEmail,
  onClose,
  onSubmit,
  onResend,
}: {
  email: string;
  setEmail: (s: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onResend: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-5 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl p-7 max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="inline-flex items-center gap-2 mb-1">
          <LuQrCode className="size-5 text-[var(--color-primary)]" />
          <h3 className="text-lg font-bold text-[var(--color-primary)]">
            El invitado no recibió el QR
          </h3>
        </div>
        <p className="text-sm text-[var(--muted)] mb-4 leading-relaxed">
          Registra al invitado por su correo. Lo marcaremos como asistente. Si prefiere recibir
          el QR de nuevo, pulsa &quot;Reenviar QR&quot;.
        </p>
        <input
          type="email"
          autoFocus
          autoComplete="off"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com"
          className="w-full px-3.5 py-3 border border-[var(--border)] rounded-xl text-base mb-3.5 focus:outline-2 focus:outline-[var(--color-primary)]"
        />
        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-1 py-3.5 bg-[var(--color-pale)] text-[var(--color-primary-dark)] rounded-xl font-semibold text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={onSubmit}
            className="flex-1 py-3.5 bg-[var(--color-primary)] text-white rounded-xl font-semibold text-sm"
          >
            Registrar
          </button>
        </div>
        <p className="mt-3.5 text-center text-xs">
          <button
            onClick={onResend}
            className="text-[var(--color-primary)] font-medium underline-offset-2 hover:underline inline-flex items-center gap-1"
          >
            <LuMail className="size-3.5" />
            O reenviar el QR a este correo
          </button>
        </p>
      </div>
    </div>
  );
}
