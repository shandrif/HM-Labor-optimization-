import { useEffect, useMemo, useState } from "react";
import { api, cachedApi, type User } from "../api";
import { dialog, Icon, PageSkeleton, toast } from "../ui";
import {
  ACTION_LABEL,
  compute,
  planDeltas,
  ROLES,
  ROLE_LABEL,
  ROLE_SHORT,
  suggestTransfers,
  type BranchRow,
  type RoleKey,
  fmtWhen,
} from "../calc";

type Branch = { code: string; name: string; region: string | null };
export type ActionDraft = {
  type: "transfer" | "promote" | "hire";
  from_branch: string;
  from_role: RoleKey;
  to_branch: string;
  to_role: RoleKey;
  qty: number;
  employee: string;
  effective_date: string;
  reason: string;
};
const EMPTY: ActionDraft = {
  type: "transfer",
  from_branch: "",
  from_role: "ba",
  to_branch: "",
  to_role: "ba",
  qty: 1,
  employee: "",
  effective_date: "",
  reason: "",
};

export function describeAction(a: any, names?: Map<string, string>) {
  const n = (c: string | null) => (c ? (names?.get(c) ? `${c} ${names.get(c)}` : c) : "");
  const r = (k: RoleKey | null) => (k ? ROLE_SHORT[k] : "");
  if (a.type === "hire") return `Hire ${a.qty} × ${r(a.to_role)} at ${n(a.to_branch)}`;
  if (a.type === "transfer") return `Transfer ${a.qty} × ${r(a.to_role)}: ${n(a.from_branch)} → ${n(a.to_branch)}`;
  return a.from_branch === a.to_branch
    ? `Promote ${a.qty} × ${r(a.from_role)} → ${r(a.to_role)} at ${n(a.to_branch)}`
    : `Move ${a.qty} × ${r(a.from_role)} at ${n(a.from_branch)} → ${r(a.to_role)} at ${n(a.to_branch)}`;
}

type Staff = {
  emp_no: string;
  name: string;
  title: string | null;
  role: string;
  branch_code: string | null;
  joining_date: string | null;
  company: string | null;
  in_action: { id: number; type: string; status: string } | null;
};

function tenure(d: string | null) {
  if (!d) return null;
  const start = new Date(d);
  if (isNaN(+start)) return null;
  const months = Math.max(0, Math.floor((Date.now() - +start) / (30.44 * 864e5)));
  const y = Math.floor(months / 12), m = months % 12;
  return y ? `${y}y ${m}m` : `${m}m`;
}

/** Suggests staff at a branch in a role (from the latest headcount upload). */
function StaffPicker({
  branch,
  role,
  picked,
  onChange,
}: {
  branch: string;
  role: RoleKey;
  picked: Staff[];
  onChange: (s: Staff[]) => void;
}) {
  const [list, setList] = useState<Staff[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!branch) return setList(null);
    let live = true;
    setList(null);
    setErr("");
    api(`/employees?branch=${encodeURIComponent(branch)}&role=${role}`)
      .then((r) => {
        if (!live) return;
        setList(r.employees);
        setSource(r.source);
      })
      .catch((e) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [branch, role]);

  const toggle = (e: Staff) =>
    onChange(picked.some((p) => p.emp_no === e.emp_no) ? picked.filter((p) => p.emp_no !== e.emp_no) : [...picked, e]);

  if (!branch) return <div className="staffpick empty">Choose a branch to see its {ROLE_LABEL[role].toLowerCase()}s.</div>;
  if (err) return <div className="staffpick empty">{err}</div>;
  if (!list) return <div className="staffpick empty">Loading staff…</div>;
  if (!source)
    return (
      <div className="staffpick empty">
        No staff list yet — upload the weekly headcount file to get name suggestions.
      </div>
    );

  const ql = q.trim().toLowerCase();
  const shown = list.filter((e) => !ql || `${e.name} ${e.emp_no}`.toLowerCase().includes(ql));
  return (
    <div className="staffpick">
      <div className="staffpick-head">
        <span>
          {list.length} {ROLE_LABEL[role].toLowerCase()}
          {list.length === 1 ? "" : "s"} at {branch} <span className="muted">· from {source}</span>
        </span>
        {list.length > 6 && (
          <input className="sp-search" placeholder="Filter by name or no." value={q} onChange={(e) => setQ(e.target.value)} />
        )}
      </div>
      <ul>
        {shown.map((e) => {
          const on = picked.some((p) => p.emp_no === e.emp_no);
          const blocked = !!e.in_action && !on;
          const t = tenure(e.joining_date);
          return (
            <li key={e.emp_no}>
              <button
                type="button"
                className={`sp-row ${on ? "on" : ""}`}
                disabled={blocked}
                onClick={() => toggle(e)}
                title={blocked ? `Already in ${e.in_action!.status} action #${e.in_action!.id}` : ""}
              >
                <span className="sp-check">{on && <Icon name="check" />}</span>
                <span className="sp-main">
                  <span className="sp-name">{e.name}</span>
                  <span className="sp-meta">
                    #{e.emp_no}
                    {e.title ? ` · ${e.title}` : ""}
                    {t ? ` · ${t} tenure` : ""}
                    {e.company && e.company !== "Half Million" ? ` · ${e.company}` : ""}
                  </span>
                </span>
                {e.in_action && <span className="pill warn">In {e.in_action.status} action</span>}
              </button>
            </li>
          );
        })}
        {!shown.length && <li className="muted sp-none">No {ROLE_LABEL[role].toLowerCase()} found at this branch.</li>}
      </ul>
    </div>
  );
}

export function ActionForm({
  branches,
  user,
  initial,
  onSaved,
  onCancel,
}: {
  branches: Branch[];
  user: User;
  initial?: Partial<ActionDraft>;
  onSaved: (msg: string) => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState<ActionDraft>({ ...EMPTY, ...initial });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Staff[]>([]);
  const isAdmin = user.role === "admin";

  const set = (patch: Partial<ActionDraft>) => {
    // changing who/where clears the picked staff
    if ("type" in patch || "from_branch" in patch || "from_role" in patch) setPicked([]);
    setF((x) => ({ ...x, ...patch }));
  };
  const pick = (s: Staff[]) => {
    setPicked(s);
    if (s.length) setF((x) => ({ ...x, qty: s.length }));
  };
  const branchSelect = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {branches.map((b) => (
        <option key={b.code} value={b.code}>
          {b.code} · {b.name}
        </option>
      ))}
    </select>
  );
  const roleSelect = (value: RoleKey, onChange: (v: RoleKey) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as RoleKey)}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_SHORT[r]} — {ROLE_LABEL[r]}
        </option>
      ))}
    </select>
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const employee = picked.length ? picked.map((p) => `${p.name} (#${p.emp_no})`).join(", ") : f.employee;
    const body: any = {
      type: f.type,
      qty: f.qty,
      employee,
      employee_nos: picked.map((p) => p.emp_no),
      effective_date: f.effective_date,
      reason: f.reason,
    };
    if (f.type === "hire") Object.assign(body, { to_branch: f.to_branch, to_role: f.to_role });
    if (f.type === "transfer") Object.assign(body, { from_branch: f.from_branch, to_branch: f.to_branch, from_role: f.from_role, to_role: f.from_role });
    if (f.type === "promote")
      Object.assign(body, { from_branch: f.from_branch, to_branch: f.to_branch || f.from_branch, from_role: f.from_role, to_role: f.to_role });
    if ((f.type !== "hire" && !f.from_branch) || (f.type !== "promote" && !f.to_branch)) return setError("Choose the branch(es)");
    setBusy(true);
    try {
      const r = await api("/actions", { method: "POST", json: body });
      onSaved(r.approved ? "Action saved and approved." : "Action sent to Admin for approval.");
      setF({ ...EMPTY });
      setPicked([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="seg">
        {(["transfer", "promote", "hire"] as const).map((t) => (
          <button type="button" key={t} className={f.type === t ? "on" : ""} onClick={() => set({ type: t })}>
            {ACTION_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="formgrid">
        {f.type !== "hire" && (
          <label>
            {f.type === "transfer" ? "From branch" : "Branch"}
            {branchSelect(f.from_branch, (v) => set({ from_branch: v }), "Choose branch…")}
          </label>
        )}
        {f.type === "transfer" && (
          <label>
            To branch
            {branchSelect(f.to_branch, (v) => set({ to_branch: v }), "Choose branch…")}
          </label>
        )}
        {f.type === "hire" && (
          <label>
            Branch
            {branchSelect(f.to_branch, (v) => set({ to_branch: v }), "Choose branch…")}
          </label>
        )}
        {f.type === "transfer" && <label>Role{roleSelect(f.from_role, (v) => set({ from_role: v }))}</label>}
        {f.type === "promote" && (
          <>
            <label>Current role{roleSelect(f.from_role, (v) => set({ from_role: v }))}</label>
            <label>New role{roleSelect(f.to_role, (v) => set({ to_role: v }))}</label>
            <label>
              Move to branch (optional)
              {branchSelect(f.to_branch, (v) => set({ to_branch: v }), "Same branch")}
            </label>
          </>
        )}
        {f.type === "hire" && <label>Role{roleSelect(f.to_role, (v) => set({ to_role: v }))}</label>}
        <label>
          Number of staff
          <input
            type="number"
            min={Math.max(1, picked.length)}
            max={100}
            value={f.qty}
            onChange={(e) => set({ qty: Math.min(100, Math.max(1, picked.length, parseInt(e.target.value, 10) || 1)) })}
          />
        </label>
        {f.type === "hire" && (
          <label>
            Candidate name (optional)
            <input value={f.employee} onChange={(e) => set({ employee: e.target.value })} />
          </label>
        )}
        <label>
          Effective date (optional)
          <input type="date" value={f.effective_date} onChange={(e) => set({ effective_date: e.target.value })} />
        </label>
      </div>
      {f.type !== "hire" && (
        <div className="field">
          <div className="field-label">
            Who {picked.length ? <span className="muted">· {picked.length} selected</span> : <span className="muted">(optional)</span>}
          </div>
          <StaffPicker branch={f.from_branch} role={f.from_role} picked={picked} onChange={pick} />
        </div>
      )}
      <label>
        Reason {isAdmin ? "(optional)" : ""}
        <textarea rows={2} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginBottom: 16 }}>
        <button className="primary" disabled={busy || (!isAdmin && !f.reason.trim())}>
          {isAdmin ? "Save action" : "Send for approval"}
        </button>
        {onCancel && (
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function ActionList({ list, user, names, onChange }: { list: any[]; user: User; names: Map<string, string>; onChange: () => void }) {
  const isAdmin = user.role === "admin";
  const [busyId, setBusyId] = useState<number | null>(null);
  const run = async (a: any, op: string) => {
    let note = "";
    if (op === "reject" || op === "cancel") {
      const p = await dialog.prompt({
        title: op === "reject" ? "Reject this action?" : isAdmin ? "Cancel this action?" : "Withdraw this request?",
        message: describeAction(a, names),
        label: "Reason (optional)",
        confirmLabel: op === "reject" ? "Reject" : op === "cancel" && !isAdmin ? "Withdraw" : "Cancel action",
        danger: true,
      });
      if (p === null) return;
      note = p;
    }
    setBusyId(a.id);
    try {
      await api(`/actions/${a.id}/${op}`, { method: "POST", json: { note } });
      toast(
        { approve: "Action approved", reject: "Action rejected", complete: "Marked as completed", cancel: isAdmin ? "Action cancelled" : "Request withdrawn" }[op] ??
          "Updated",
      );
      onChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <div className="tablewrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Action</th>
            <th>Employee</th>
            <th>Effective</th>
            <th>Requested</th>
            <th>Reason</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                  <span className={`pill plain type-${a.type}`}>{ACTION_LABEL[a.type as keyof typeof ACTION_LABEL]}</span>
                  <span>{describeAction(a, names).replace(/^(Transfer|Hire|Promote|Move) /, "")}</span>
                </div>
              </td>
              <td className="small">{a.employee || <span className="muted">—</span>}</td>
              <td className="small nowrap">{a.effective_date || <span className="muted">—</span>}</td>
              <td className="small nowrap">
                {a.requested_by_name}
                <div className="muted">{fmtWhen(a.created_at)}</div>
              </td>
              <td className="small" style={{ maxWidth: 260 }}>
                {a.reason || <span className="muted">—</span>}
              </td>
              <td>
                <span className={`pill ${a.status}`}>{a.status}</span>
                {a.review_note && <div className="muted small" style={{ marginTop: 4 }}>{a.review_note}</div>}
              </td>
              <td>
                <div className="rowactions">
                  {isAdmin && a.status === "pending" && (
                    <>
                      <button className="primary sm" disabled={busyId === a.id} onClick={() => run(a, "approve")}>
                        Approve
                      </button>
                      <button className="ghost sm" disabled={busyId === a.id} onClick={() => run(a, "reject")}>
                        Reject
                      </button>
                    </>
                  )}
                  {isAdmin && a.status === "approved" && (
                    <>
                      <button className="ghost sm" disabled={busyId === a.id} title="Done — now reflected in the headcount upload" onClick={() => run(a, "complete")}>
                        <Icon name="check" />
                        Completed
                      </button>
                      <button className="quiet sm" disabled={busyId === a.id} onClick={() => run(a, "cancel")}>
                        Cancel
                      </button>
                    </>
                  )}
                  {!isAdmin && a.status === "pending" && a.requested_by === user.id && (
                    <button className="ghost sm" disabled={busyId === a.id} onClick={() => run(a, "cancel")}>
                      Withdraw
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!list.length && (
            <tr>
              <td colSpan={7} className="center-text">
                No actions here yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function Actions({ user }: { user: User }) {
  const [list, setList] = useState<any[] | null>(null);
  const [dash, setDash] = useState<{ branches: BranchRow[]; actions: any[] } | null>(null);
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Partial<ActionDraft> | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [sugRole, setSugRole] = useState("");
  const [sugSame, setSugSame] = useState(true);
  const canEdit = user.role !== "viewer";

  const load = () => {
    api(`/actions?status=${status}`).then((r) => setList(r.actions)).catch((e) => setError(e.message));
    cachedApi("/dashboard").then(setDash).catch((e) => setError(e.message));
  };
  useEffect(load, [status]);

  const branches = useMemo(() => (dash?.branches ?? []).map((b) => ({ code: b.code, name: b.name, region: b.region })), [dash]);
  const names = useMemo(() => new Map(branches.map((b) => [b.code, b.name])), [branches]);
  const computed = useMemo(() => {
    if (!dash) return [];
    const d = planDeltas(dash.actions);
    return dash.branches.map((b) => compute(b, d.get(b.code)));
  }, [dash]);
  const allSuggestions = useMemo(() => suggestTransfers(computed), [computed]);
  const suggestions = allSuggestions.filter((s) => (!sugRole || s.role === sugRole) && (!sugSame || s.sameRegion));

  if (error) return <div className="error">{error}</div>;
  if (!list || !dash) return <PageSkeleton kpis={0} />;

  const filtered = list.filter(
    (a) =>
      (!type || a.type === type) &&
      (!q.trim() ||
        `${a.from_branch ?? ""} ${a.from_branch_name ?? ""} ${a.to_branch} ${a.to_branch_name} ${a.employee ?? ""}`
          .toLowerCase()
          .includes(q.trim().toLowerCase())),
  );
  const counts = {
    pending: list.filter((a) => a.status === "pending").length,
    approved: list.filter((a) => a.status === "approved").length,
  };

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">{counts.pending} pending · {counts.approved} approved</div>
          <h1>Staffing actions</h1>
          <p>
            Transfers, promotions and hires. Approved actions count towards projected headcount until Admin marks them
            completed in a headcount upload.
            {user.role === "manager" && " Your actions go to Admin for approval."}
          </p>
        </div>
        {canEdit && !showForm && (
          <button
            className="primary"
            onClick={() => {
              setDraft(undefined);
              setShowForm(true);
            }}
          >
            <Icon name="plus" />
            New action
          </button>
        )}
      </div>

      {showForm && (
        <section className="card panel">
          <div className="cardhead">
            <h2>New action</h2>
          </div>
          <ActionForm
            key={JSON.stringify(draft ?? {})}
            branches={branches}
            user={user}
            initial={draft}
            onSaved={(m) => {
              toast(m);
              setShowForm(false);
              load();
            }}
            onCancel={() => setShowForm(false)}
          />
        </section>
      )}

      <section className="card flush">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Icon name="search" />
              <input placeholder="Search branch or employee" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Open (pending + approved)</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All</option>
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All types</option>
              <option value="transfer">Transfers</option>
              <option value="promote">Promotions / moves</option>
              <option value="hire">Hires</option>
            </select>
          </div>
          <div className="meta">
            <span>{filtered.length} actions</span>
          </div>
        </div>
        <ActionList list={filtered} user={user} names={names} onChange={load} />
      </section>

      {canEdit && (
        <section className="card flush reveal">
          <div className="cardhead">
            <div>
              <h2>Suggested transfers</h2>
              <div className="sub">
                Surplus → short branches per role, after approved actions. Check distance and people before proposing.
              </div>
            </div>
            <button className="ghost sm" onClick={() => setShowSug((s) => !s)}>
              {showSug ? "Hide" : `Show ${allSuggestions.length}`}
            </button>
          </div>
          {showSug && (
            <div className="panel">
              <div className="toolbar" style={{ borderTop: "1px solid var(--hairline)" }}>
                <div className="filters">
                  <select value={sugRole} onChange={(e) => setSugRole(e.target.value)}>
                    <option value="">All roles</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_SHORT[r]} — {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                  <label className="check">
                    <input type="checkbox" checked={sugSame} onChange={(e) => setSugSame(e.target.checked)} />
                    Same region only
                  </label>
                  <span className="muted small" style={{ marginLeft: "auto" }}>
                    {suggestions.length} shown
                  </span>
                </div>
              </div>
              <div className="tablewrap tall">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>From · surplus</th>
                      <th>To · short</th>
                      <th className="num">Staff</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {suggestions.map((s, i) => (
                      <tr key={i}>
                        <td>
                          <span className="pill plain role">{ROLE_SHORT[s.role]}</span>
                        </td>
                        <td>
                          <div className="branchcell">
                            <span className="code">{s.from}</span>
                            <span>{names.get(s.from)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="branchcell">
                            <span className="code">{s.to}</span>
                            <span>
                              {names.get(s.to)}
                              {!s.sameRegion && <span className="pill warn inline-pill">Other region</span>}
                            </span>
                          </div>
                        </td>
                        <td className="num b">{s.qty}</td>
                        <td>
                          <div className="rowactions">
                            <button
                              className="ghost sm"
                              onClick={() => {
                                setDraft({ type: "transfer", from_branch: s.from, to_branch: s.to, from_role: s.role, qty: s.qty });
                                setShowForm(true);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Propose
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {!suggestions.length && (
                      <tr>
                        <td colSpan={5} className="center-text">
                          No transfer would close a gap right now.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
