import { useEffect, useRef, useState, type ReactNode } from "react";

/* ---------- Icons (1.7px stroke, 24 grid) ---------- */
const paths: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
    </>
  ),
  actions: (
    <>
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </>
  ),
  approvals: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.4 2.3 4.6-4.9" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4.5" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.5" />
      <path d="M2.5 19.5c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
      <path d="M15.5 5.2a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18 14.8c1.7.7 3 2.2 3.5 4.7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  back: <path d="M15 5.5 8.5 12l6.5 6.5" />,
  chevron: <path d="m9.5 6 6 6-6 6" />,
  arrowDown: <path d="M12 5v14M6.5 13.5 12 19l5.5-5.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  download: (
    <>
      <path d="M12 4.5v11" />
      <path d="m7.5 11 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" />
      <path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10v4Z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z" />
      <path d="M13.5 3.5V9H19" />
      <path d="M9 13.5h6M9 17h4" />
    </>
  ),
};

export function Icon({ name, className }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/* ---------- Toasts ---------- */
type ToastItem = { id: number; text: string; kind: "ok" | "error"; leaving?: boolean };
let pushToast: ((t: Omit<ToastItem, "id">) => void) | null = null;
export const toast = Object.assign((text: string) => pushToast?.({ text, kind: "ok" }), {
  error: (text: string) => pushToast?.({ text, kind: "error" }),
});

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    pushToast = (t) => {
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      const hold = t.kind === "error" ? 6000 : 3500;
      setTimeout(() => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, leaving: true } : x))), hold);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), hold + 220);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""} ${t.leaving ? "leaving" : ""}`}>
          <span className="dot">
            <Icon name={t.kind === "error" ? "x" : "check"} />
          </span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------- Dialogs (confirm / prompt) ---------- */
type DialogReq = {
  title: string;
  message?: string;
  input?: { label: string; placeholder?: string; type?: string; required?: boolean };
  confirmLabel?: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
};
let openDialog: ((d: DialogReq) => void) | null = null;

export const dialog = {
  confirm: (o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }) =>
    new Promise<boolean>((resolve) => openDialog?.({ ...o, resolve: (v) => resolve(v === true) })),
  prompt: (o: {
    title: string;
    message?: string;
    label: string;
    placeholder?: string;
    type?: string;
    required?: boolean;
    confirmLabel?: string;
    danger?: boolean;
  }) =>
    new Promise<string | null>((resolve) =>
      openDialog?.({
        title: o.title,
        message: o.message,
        confirmLabel: o.confirmLabel,
        danger: o.danger,
        input: { label: o.label, placeholder: o.placeholder, type: o.type, required: o.required },
        resolve: (v) => resolve(typeof v === "string" ? v : null),
      }),
    ),
};

export function DialogHost() {
  const [req, setReq] = useState<DialogReq | null>(null);
  const [value, setValue] = useState("");
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    openDialog = (d) => {
      setValue("");
      setClosing(false);
      setReq(d);
    };
    return () => {
      openDialog = null;
    };
  }, []);

  const close = (result: string | boolean | null) => {
    if (!req) return;
    req.resolve(result);
    setClosing(true);
    setTimeout(() => setReq(null), 160);
  };

  useEffect(() => {
    if (!req) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(null);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [req]);

  if (!req) return null;
  const invalid = !!req.input?.required && !value.trim();
  return (
    <div className={`scrim ${closing ? "closing" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) close(req.input ? value : true);
        }}
      >
        <h2>{req.title}</h2>
        {req.message && <p>{req.message}</p>}
        {req.input && (
          <label>
            {req.input.label}
            <input
              ref={inputRef}
              type={req.input.type ?? "text"}
              placeholder={req.input.placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={() => close(null)}>
            {req.danger ? "Go back" : "Cancel"}
          </button>
          <button className={req.danger ? "danger" : "primary"} disabled={invalid} autoFocus={!req.input}>
            {req.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Skeleton ---------- */
export function PageSkeleton({ kpis = 4, lines = 8 }: { kpis?: number; lines?: number }) {
  return (
    <div className="page" aria-busy="true">
      <div className="pagehead">
        <div style={{ width: "100%" }}>
          <div className="sk" style={{ width: 240, height: 30 }} />
          <div className="sk" style={{ width: 380, height: 14, marginTop: 12, maxWidth: "80%" }} />
        </div>
      </div>
      <div className="kpis">
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="sk sk-kpi" />
        ))}
      </div>
      <div className="card">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="sk sk-line" style={{ width: `${70 + ((i * 37) % 30)}%` }} />
        ))}
      </div>
    </div>
  );
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
