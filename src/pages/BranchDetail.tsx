import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { fmt, fmtPct, fmtSar, fmtSigned, planDeltas, ROLES, ROLE_LABEL, ROLE_SHORT, type RoleKey } from "../calc";
import { ActionForm, ActionList } from "./Actions";

type Counts = Record<RoleKey, number>;

export default function BranchDetail({ code, user }: { code: string; user: User }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<Counts | null>(null);
  const [reason, setReason] = useState("");
  const [info, setInfo] = useState<any>(null);
  const [newAction, setNewAction] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [branchList, setBranchList] = useState<any[]>([]);
  const isAdmin = user.role === "admin";
  const canEdit = user.role !== "viewer";

  const load = () => api(`/branches/${encodeURIComponent(code)}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [code]);
  useEffect(() => {
    api("/dashboard").then((r) => {
      setBranchList(r.branches);
      setNames(new Map(r.branches.map((b: any) => [b.code, b.name])));
    });
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!d) return <div className="muted">Loading…</div>;

  const b = d.branch;
  const opt = d.optimum as Counts | null;
  const act = d.history[0] as (Counts & { period_label: string; other: number }) | undefined;
  const sum = (c?: Partial<Counts> | null) => (c ? ROLES.reduce((s, r) => s + (Number(c[r]) || 0), 0) : null);
  const budget = Object.fromEntries(ROLES.map((r) => [r, b[`budget_${r}`]])) as Counts;
  const aTot = sum(act), oTot = sum(opt), eTot = sum(edit);
  const prod = (hc: number | null) => (hc && b.ads ? b.ads / hc : null);
  const aProd = prod(aTot), oProd = prod(oTot), eProd = prod(eTot);
  const change = (p: number | null) => (aProd && p ? p / aProd - 1 : null);
  const delta = planDeltas(d.actions.filter((a: any) => a.status === "approved")).get(code);
  const proj = act && delta ? (Object.fromEntries(ROLES.map((r) => [r, act[r] + delta[r]])) as Counts) : null;
  const pTot = sum(proj);

  const save = async () => {
    setMsg("");
    try {
      const r = await api(`/branches/${encodeURIComponent(code)}/optimum`, { method: "POST", json: { ...edit, reason } });
      setMsg(r.applied ? "Optimum headcount updated." : "Change sent to Admin for approval.");
      setEdit(null);
      setReason("");
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  const saveInfo = async () => {
    try {
      await api(`/branches/${encodeURIComponent(code)}`, { method: "PUT", json: info });
      setInfo(null);
      setMsg("Branch details saved.");
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };

  return (
    <>
      <a href="#/" className="back">
        ← All branches
      </a>
      <div className="pagehead">
        <div>
          <h1>
            <span className="mono">{b.code}</span> {b.name}
          </h1>
          <p className="muted">
            {[b.region, b.city, b.size_tier && `Tier ${b.size_tier}`, b.store_type, b.working_hours && `${b.working_hours}h`]
              .filter(Boolean)
              .join(" · ")}
            <br />
            Area manager: {b.area_manager ?? "—"} · Ops: {b.ops_lead ?? "—"}
          </p>
        </div>
        {isAdmin && !info && (
          <button className="ghost" onClick={() => setInfo({ ...b })}>
            Edit branch details
          </button>
        )}
      </div>

      {msg && <div className="notice">{msg}</div>}

      {info && (
        <section className="card">
          <h2>Branch details</h2>
          <div className="formgrid">
            {[
              ["name", "Name"],
              ["region", "Region"],
              ["city", "City"],
              ["area_manager", "Area manager"],
              ["ops_lead", "Ops lead"],
              ["working_hours", "Working hours"],
              ["ads", "ADS (avg daily sales)"],
              ["atc", "ATC (avg transactions/day)"],
              ["size_tier", "Size tier (L/M/S)"],
              ["store_type", "Type (DT/NDT)"],
            ].map(([k, l]) => (
              <label key={k}>
                {l}
                <input value={info[k] ?? ""} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={!!info.active} onChange={(e) => setInfo({ ...info, active: e.target.checked ? 1 : 0 })} />
              Active (shown on dashboard)
            </label>
          </div>
          <div className="actions">
            <button className="primary" onClick={saveInfo}>
              Save
            </button>
            <button className="ghost" onClick={() => setInfo(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="kpis">
        <div className="kpi">
          <div className="label">ADS</div>
          <div className="value">{b.ads ? fmt(b.ads) : "—"}</div>
          <div className="sub">ATC {b.atc ? fmt(b.atc) : "—"} · APC {b.atc ? (b.ads / b.atc).toFixed(1) : "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Actual productivity / head</div>
          <div className="value">{fmtSar(aProd)}</div>
          <div className="sub">{aTot ?? "—"} heads</div>
        </div>
        <div className="kpi">
          <div className="label">Optimum productivity / head</div>
          <div className="value">{fmtSar(oProd)}</div>
          <div className="sub">{oTot ?? "—"} heads</div>
        </div>
        <div className="kpi">
          <div className="label">Change</div>
          <div className={`value ${(change(oProd) ?? 0) > 0 ? "over" : (change(oProd) ?? 0) < 0 ? "short" : ""}`}>
            {fmtPct(change(oProd))}
          </div>
          <div className="sub">Optimum vs actual</div>
        </div>
      </section>

      <section className="card">
        <div className="cardhead">
          <h2>Headcount by role</h2>
          {canEdit && !edit && (
            <button className="primary" onClick={() => setEdit({ ...(opt ?? { sm: 0, tl: 0, ba: 0, ca: 0, cl: 0 }) })}>
              {isAdmin ? "Edit optimum" : "Request optimum change"}
            </button>
          )}
        </div>
        <div className="tablewrap">
          <table className="roles">
            <thead>
              <tr>
                <th></th>
                {ROLES.map((r) => (
                  <th key={r} className="num" title={ROLE_LABEL[r]}>
                    {ROLE_SHORT[r]}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Budget</td>
                {ROLES.map((r) => (
                  <td key={r} className="num">
                    {budget[r]}
                  </td>
                ))}
                <td className="num b">{sum(budget)}</td>
              </tr>
              <tr>
                <td>Actual {act && <span className="muted small">({act.period_label})</span>}</td>
                {ROLES.map((r) => (
                  <td key={r} className="num">
                    {act ? act[r] : "—"}
                  </td>
                ))}
                <td className="num b">{aTot ?? "—"}</td>
              </tr>
              <tr>
                <td>Optimum</td>
                {ROLES.map((r) => (
                  <td key={r} className="num">
                    {opt ? opt[r] : "—"}
                  </td>
                ))}
                <td className="num b">{oTot ?? "—"}</td>
              </tr>
              <tr>
                <td>Net requirement</td>
                {ROLES.map((r) => {
                  const g = opt && act ? opt[r] - act[r] : null;
                  return (
                    <td key={r} className={`num b ${g && g > 0 ? "short" : g && g < 0 ? "over" : ""}`}>
                      {g == null ? "—" : fmtSigned(g)}
                    </td>
                  );
                })}
                <td className="num b">{oTot != null && aTot != null ? fmtSigned(oTot - aTot) : "—"}</td>
              </tr>
              {proj && (
                <>
                  <tr>
                    <td>
                      Planned actions <span className="muted small">(approved)</span>
                    </td>
                    {ROLES.map((r) => (
                      <td key={r} className="num">
                        {delta![r] ? fmtSigned(delta![r]) : "0"}
                      </td>
                    ))}
                    <td className="num b">{fmtSigned(pTot! - aTot!)}</td>
                  </tr>
                  <tr>
                    <td>Projected</td>
                    {ROLES.map((r) => (
                      <td key={r} className="num">
                        {proj[r]}
                      </td>
                    ))}
                    <td className="num b">{pTot}</td>
                  </tr>
                  <tr>
                    <td>Gap after actions</td>
                    {ROLES.map((r) => {
                      const g = opt ? opt[r] - proj[r] : null;
                      return (
                        <td key={r} className={`num b ${g && g > 0 ? "short" : g && g < 0 ? "over" : "ok"}`}>
                          {g == null ? "—" : fmtSigned(g)}
                        </td>
                      );
                    })}
                    <td className="num b">{oTot != null ? fmtSigned(oTot - pTot!) : "—"}</td>
                  </tr>
                </>
              )}
              {edit && (
                <tr className="editrow">
                  <td>New optimum</td>
                  {ROLES.map((r) => (
                    <td key={r} className="num">
                      <input
                        type="number"
                        min={0}
                        max={500}
                        value={edit[r]}
                        onChange={(e) => setEdit({ ...edit, [r]: Math.max(0, parseInt(e.target.value || "0", 10)) })}
                      />
                    </td>
                  ))}
                  <td className="num b">{eTot}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {act && act.other > 0 && (
          <p className="muted small">Plus {act.other} staff with other titles at this location (not counted in productivity).</p>
        )}
        {edit && (
          <div className="editbox">
            <p>
              New optimum productivity: <b>{fmtSar(eProd)}</b> per head ·{" "}
              <b className={(change(eProd) ?? 0) > 0 ? "over" : (change(eProd) ?? 0) < 0 ? "short" : ""}>{fmtPct(change(eProd))}</b>{" "}
              vs actual
            </p>
            <label>
              Reason {isAdmin ? "(optional)" : ""}
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="actions">
              <button className="primary" onClick={save} disabled={!isAdmin && !reason.trim()}>
                {isAdmin ? "Save optimum" : "Send for approval"}
              </button>
              <button className="ghost" onClick={() => setEdit(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {opt && (opt as any).updated_by_name && (
          <p className="muted small">
            Optimum last set by {(opt as any).updated_by_name} on {(opt as any).updated_at?.slice(0, 10)}
          </p>
        )}
      </section>

      <section className="card">
        <div className="cardhead">
          <h2>Transfers, promotions & hires</h2>
          {canEdit && !newAction && (
            <button className="ghost" onClick={() => setNewAction(true)}>
              New action
            </button>
          )}
        </div>
        {newAction && (
          <div className="editbox" style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <ActionForm
              branches={branchList}
              user={user}
              initial={{ from_branch: code, to_branch: "" }}
              onSaved={(m) => {
                setMsg(m);
                setNewAction(false);
                load();
              }}
              onCancel={() => setNewAction(false)}
            />
          </div>
        )}
        <ActionList list={d.actions} user={user} names={names} onChange={load} />
      </section>

      <div className="two">
        <section className="card">
          <h2>Headcount history</h2>
          <table className="roles">
            <thead>
              <tr>
                <th>Period</th>
                {ROLES.map((r) => (
                  <th key={r} className="num">
                    {ROLE_SHORT[r]}
                  </th>
                ))}
                <th className="num">Total</th>
                <th className="num">Prod/head</th>
              </tr>
            </thead>
            <tbody>
              {d.history.map((h: any) => {
                const t = sum(h)!;
                return (
                  <tr key={h.upload_id}>
                    <td>{h.period_label}</td>
                    {ROLES.map((r) => (
                      <td key={r} className="num">
                        {h[r]}
                      </td>
                    ))}
                    <td className="num b">{t}</td>
                    <td className="num">{fmtSar(prod(t))}</td>
                  </tr>
                );
              })}
              {!d.history.length && (
                <tr>
                  <td colSpan={8} className="muted">
                    No headcount uploaded for this branch yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Optimum changes</h2>
          <ul className="log">
            {d.requests.map((r: any) => (
              <li key={r.id}>
                <span className={`pill ${r.status}`}>{r.status}</span> {ROLES.map((k) => `${ROLE_SHORT[k]} ${r[k]}`).join(" · ")}
                <div className="muted small">
                  {r.requested_by_name} · {r.created_at?.slice(0, 16)}
                  {r.reason && <> · “{r.reason}”</>}
                  {r.reviewed_by_name && r.reviewed_by !== r.requested_by && <> · reviewed by {r.reviewed_by_name}</>}
                </div>
              </li>
            ))}
            {!d.requests.length && <li className="muted">No changes yet.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
