import { useEffect, useMemo, useState } from "react";
import { api, type User } from "../api";
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
  const isAdmin = user.role === "admin";

  const set = (patch: Partial<ActionDraft>) => setF((x) => ({ ...x, ...patch }));
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
    const body: any = { type: f.type, qty: f.qty, employee: f.employee, effective_date: f.effective_date, reason: f.reason };
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
          <input type="number" min={1} max={100} value={f.qty} onChange={(e) => set({ qty: Math.max(1, parseInt(e.target.value || "1", 10)) })} />
        </label>
        <label>
          Employee name / no. (optional)
          <input value={f.employee} onChange={(e) => set({ employee: e.target.value })} />
        </label>
        <label>
          Effective date (optional)
          <input type="date" value={f.effective_date} onChange={(e) => set({ effective_date: e.target.value })} />
        </label>
      </div>
      <label>
        Reason {isAdmin ? "(optional)" : ""}
        <textarea rows={2} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
      </label>
      {error && <div className="error">{error}</div>}
      <div className="actions">
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
  const [error, setError] = useState("");
  const isAdmin = user.role === "admin";
  const run = async (id: number, op: string) => {
    let note = "";
    if (op === "reject" || op === "cancel") {
      const p = prompt(op === "reject" ? "Reason for rejecting (optional)" : "Reason for cancelling (optional)");
      if (p === null) return;
      note = p;
    }
    setError("");
    try {
      await api(`/actions/${id}/${op}`, { method: "POST", json: { note } });
      onChange();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <>
      {error && <div className="error">{error}</div>}
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
                  <span className={`pill type-${a.type}`}>{ACTION_LABEL[a.type as keyof typeof ACTION_LABEL]}</span>{" "}
                  {describeAction(a, names).replace(/^(Transfer|Hire|Promote|Move) /, "")}
                </td>
                <td className="small">{a.employee || <span className="muted">—</span>}</td>
                <td className="small nowrap">{a.effective_date || <span className="muted">—</span>}</td>
                <td className="small">
                  {a.requested_by_name}
                  <div className="muted">{a.created_at?.slice(0, 16)}</div>
                </td>
                <td className="small">{a.reason || <span className="muted">—</span>}</td>
                <td>
                  <span className={`pill ${a.status}`}>{a.status}</span>
                  {a.review_note && <div className="muted small">{a.review_note}</div>}
                </td>
                <td className="nowrap">
                  {isAdmin && a.status === "pending" && (
                    <>
                      <button className="primary sm" onClick={() => run(a.id, "approve")}>
                        Approve
                      </button>{" "}
                      <button className="ghost sm" onClick={() => run(a.id, "reject")}>
                        Reject
                      </button>
                    </>
                  )}
                  {isAdmin && a.status === "approved" && (
                    <>
                      <button className="ghost sm" title="Done — now reflected in the headcount upload" onClick={() => run(a.id, "complete")}>
                        Mark completed
                      </button>{" "}
                      <button className="ghost sm" onClick={() => run(a.id, "cancel")}>
                        Cancel
                      </button>
                    </>
                  )}
                  {!isAdmin && a.status === "pending" && a.requested_by === user.id && (
                    <button className="ghost sm" onClick={() => run(a.id, "cancel")}>
                      Withdraw
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={7} className="muted center-text">
                  No actions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Actions({ user }: { user: User }) {
  const [list, setList] = useState<any[]>([]);
  const [dash, setDash] = useState<{ branches: BranchRow[]; actions: any[] } | null>(null);
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Partial<ActionDraft> | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [showSug, setShowSug] = useState(false);
  const [sugRole, setSugRole] = useState("");
  const [sugSame, setSugSame] = useState(true);
  const canEdit = user.role !== "viewer";

  const load = () => {
    api(`/actions?status=${status}`).then((r) => setList(r.actions)).catch((e) => setError(e.message));
    api("/dashboard").then(setDash).catch((e) => setError(e.message));
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
    <>
      <div className="pagehead">
        <div>
          <h1>Staffing actions</h1>
          <p className="muted">
            Transfers, promotions/moves and hires. Approved actions are added to actual headcount as the{" "}
            <b>projected headcount</b> until Admin marks them completed (once they show in a headcount upload).
            {user.role === "manager" && " Your actions are sent to Admin for approval."}
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
            New action
          </button>
        )}
      </div>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}

      {showForm && (
        <section className="card">
          <h2>New action</h2>
          <ActionForm
            key={JSON.stringify(draft ?? {})}
            branches={branches}
            user={user}
            initial={draft}
            onSaved={(m) => {
              setMsg(m);
              setShowForm(false);
              load();
            }}
            onCancel={() => setShowForm(false)}
          />
        </section>
      )}

      {canEdit && (
        <section className="card">
          <div className="cardhead">
            <h2>Suggested transfers</h2>
            <button className="ghost sm" onClick={() => setShowSug((s) => !s)}>
              {showSug ? "Hide" : `Show ${allSuggestions.length}`}
            </button>
          </div>
          <p className="muted small">
            Matches branches with surplus staff in a role to branches short in that role (after approved actions),
            same region first. Review before proposing — distance and people matter.
          </p>
          {showSug && (
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
              <span className="muted small">{suggestions.length} shown</span>
            </div>
          )}
          {showSug && (
            <div className="tablewrap">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>From (surplus)</th>
                    <th>To (short)</th>
                    <th className="num">Staff</th>
                    <th></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s, i) => (
                    <tr key={i}>
                      <td>{ROLE_SHORT[s.role]}</td>
                      <td>
                        <span className="mono">{s.from}</span> {names.get(s.from)}
                      </td>
                      <td>
                        <span className="mono">{s.to}</span> {names.get(s.to)}
                      </td>
                      <td className="num b">{s.qty}</td>
                      <td>{!s.sameRegion && <span className="pill warn">other region</span>}</td>
                      <td>
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
                      </td>
                    </tr>
                  ))}
                  {!suggestions.length && (
                    <tr>
                      <td colSpan={6} className="muted center-text">
                        No transfer would close a gap right now.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <div className="filters">
          <input placeholder="Search branch or employee…" value={q} onChange={(e) => setQ(e.target.value)} />
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
        {status === "open" && (
          <p className="muted small">
            {counts.pending} pending · {counts.approved} approved
          </p>
        )}
        <ActionList list={filtered} user={user} names={names} onChange={load} />
      </section>
    </>
  );
}
