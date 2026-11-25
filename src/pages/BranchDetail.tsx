import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { fmt, fmtSar, fmtSigned, planDeltas, ROLES, ROLE_LABEL, ROLE_SHORT, type RoleKey } from "../calc";
import { Icon, PageSkeleton, toast } from "../ui";
import { ActionForm, ActionList } from "./Actions";
import { Delta } from "./Dashboard";

type Counts = Record<RoleKey, number>;
const gapTone = (n: number | null) => (n == null ? "" : n > 0 ? "short" : n < 0 ? "over" : "ok");

export default function BranchDetail({ code, user }: { code: string; user: User }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<Counts | null>(null);
  const [reason, setReason] = useState("");
  const [info, setInfo] = useState<any>(null);
  const [newAction, setNewAction] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [branchList, setBranchList] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
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
  if (!d) return <PageSkeleton />;

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
    setBusy(true);
    try {
      const r = await api(`/branches/${encodeURIComponent(code)}/optimum`, { method: "POST", json: { ...edit, reason } });
      toast(r.applied ? "Optimum headcount updated" : "Change sent to Admin for approval");
      setEdit(null);
      setReason("");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveInfo = async () => {
    setBusy(true);
    try {
      await api(`/branches/${encodeURIComponent(code)}`, { method: "PUT", json: info });
      setInfo(null);
      toast("Branch details saved");
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div>
        <a href="#/" className="back">
          <Icon name="back" />
          All branches
        </a>
        <div className="pagehead">
          <div>
            <div className="eyebrow">
              {[b.region, b.city, b.size_tier && `Tier ${b.size_tier}`, b.store_type, b.working_hours && `${b.working_hours}h`]
                .filter(Boolean)
                .join(" · ")}
            </div>
            <h1>
              {b.name} <span className="code" style={{ verticalAlign: "middle", fontSize: 13 }}>{b.code}</span>
            </h1>
            <p>
              Area manager <b>{b.area_manager ?? "—"}</b> · Ops <b>{b.ops_lead ?? "—"}</b>
            </p>
          </div>
          {isAdmin && !info && (
            <button className="ghost" onClick={() => setInfo({ ...b })}>
              <Icon name="edit" />
              Edit details
            </button>
          )}
        </div>
      </div>

      {info && (
        <section className="card panel">
          <div className="cardhead">
            <h2>Branch details</h2>
          </div>
          <div className="formgrid" style={{ marginTop: 0 }}>
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
          </div>
          <label className="check">
            <input type="checkbox" checked={!!info.active} onChange={(e) => setInfo({ ...info, active: e.target.checked ? 1 : 0 })} />
            Active (shown on dashboard)
          </label>
          <div className="actions" style={{ marginTop: 16 }}>
            <button className="primary" onClick={saveInfo} disabled={busy}>
              Save details
            </button>
            <button className="ghost" onClick={() => setInfo(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="kpis">
        <div className="kpi accent">
          <div className="label">Optimum productivity / head</div>
          <div className="value">{fmtSar(oProd)}</div>
          <div className="sub">
            <Delta value={change(oProd)} /> at {oTot ?? "—"} heads
          </div>
        </div>
        <div className="kpi">
          <div className="label">Actual productivity / head</div>
          <div className="value">{fmtSar(aProd)}</div>
          <div className="sub">{aTot ?? "—"} heads on payroll</div>
        </div>
        <div className="kpi">
          <div className="label">Average daily sales</div>
          <div className="value">{b.ads ? fmt(b.ads) : "—"}</div>
          <div className="sub">
            {b.atc ? `${fmt(b.atc)} transactions · ${(b.ads / b.atc).toFixed(1)} per check` : "No transaction data"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Gap after actions</div>
          <div className={`value ${gapTone(oTot != null && aTot != null ? oTot - (pTot ?? aTot) : null)}`}>
            {oTot != null && aTot != null ? fmtSigned(oTot - (pTot ?? aTot)) : "—"}
          </div>
          <div className="sub">Net requirement {oTot != null && aTot != null ? fmtSigned(oTot - aTot) : "—"}</div>
        </div>
      </section>

      <section className="card flush">
        <div className="cardhead">
          <div>
            <h2>Headcount by role</h2>
            <div className="sub">{act ? `Actual from ${act.period_label}` : "No headcount uploaded for this branch"}</div>
          </div>
          {canEdit && !edit && (
            <button className={isAdmin ? "primary" : "ghost"} onClick={() => setEdit({ ...(opt ?? { sm: 0, tl: 0, ba: 0, ca: 0, cl: 0 }) })}>
              <Icon name="edit" />
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
                  <td key={r} className="num muted">
                    {budget[r]}
                  </td>
                ))}
                <td className="num b muted">{sum(budget)}</td>
              </tr>
              <tr>
                <td>Actual</td>
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
              <tr className="sep">
                <td>Net requirement</td>
                {ROLES.map((r) => {
                  const g = opt && act ? opt[r] - act[r] : null;
                  return (
                    <td key={r} className={`num b ${gapTone(g)}`}>
                      {g == null ? "—" : fmtSigned(g)}
                    </td>
                  );
                })}
                <td className={`num b ${gapTone(oTot != null && aTot != null ? oTot - aTot : null)}`}>
                  {oTot != null && aTot != null ? fmtSigned(oTot - aTot) : "—"}
                </td>
              </tr>
              {proj && (
                <>
                  <tr>
                    <td>Planned actions</td>
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
                        <td key={r} className={`num b ${gapTone(g)}`}>
                          {g == null ? "—" : fmtSigned(g)}
                        </td>
                      );
                    })}
                    <td className={`num b ${gapTone(oTot != null ? oTot - pTot! : null)}`}>{oTot != null ? fmtSigned(oTot - pTot!) : "—"}</td>
                  </tr>
                </>
              )}
              {edit && (
                <tr className="editrow">
                  <td>
                    <b>New optimum</b>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="num">
                      <input
                        type="number"
                        min={0}
                        max={500}
                        inputMode="numeric"
                        aria-label={`New optimum ${ROLE_LABEL[r]}`}
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
        {edit && (
          <div className="panel" style={{ padding: "0 24px 24px" }}>
            <div className="editbox">
              <div className="preview">
                <span>
                  New optimum productivity <b>{fmtSar(eProd)}</b> per head
                </span>
                <Delta value={change(eProd)} suffix=" vs actual" />
              </div>
              <label>
                Reason {isAdmin ? "(optional)" : ""}
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Weekend peak needs an extra barista" />
              </label>
              <div className="actions">
                <button className="primary" onClick={save} disabled={busy || (!isAdmin && !reason.trim())}>
                  {isAdmin ? "Save optimum" : "Send for approval"}
                </button>
                <button className="ghost" onClick={() => setEdit(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        {(act?.other || (opt as any)?.updated_by_name) && !edit && (
          <p className="muted small" style={{ padding: "0 24px 20px" }}>
            {act && act.other > 0 && <>Plus {act.other} staff with other titles at this location (not counted). </>}
            {(opt as any)?.updated_by_name && (
              <>
                Optimum last set by {(opt as any).updated_by_name} on {(opt as any).updated_at?.slice(0, 10)}.
              </>
            )}
          </p>
        )}
      </section>

      <section className="card flush reveal">
        <div className="cardhead">
          <div>
            <h2>Transfers, promotions & hires</h2>
            <div className="sub">Approved actions count towards projected headcount</div>
          </div>
          {canEdit && !newAction && (
            <button className="ghost" onClick={() => setNewAction(true)}>
              <Icon name="plus" />
              New action
            </button>
          )}
        </div>
        {newAction && (
          <div className="panel" style={{ padding: "0 24px 8px" }}>
            <ActionForm
              branches={branchList}
              user={user}
              initial={{ from_branch: code, to_branch: "" }}
              onSaved={(m) => {
                toast(m);
                setNewAction(false);
                load();
              }}
              onCancel={() => setNewAction(false)}
            />
          </div>
        )}
        <ActionList list={d.actions} user={user} names={names} onChange={load} />
      </section>

      <div className="two reveal">
        <section className="card flush">
          <div className="cardhead">
            <h2>Headcount history</h2>
          </div>
          <div className="tablewrap">
            <table className="grid">
              <thead>
                <tr>
                  <th>Period</th>
                  {ROLES.map((r) => (
                    <th key={r} className="num">
                      {ROLE_SHORT[r]}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Per head</th>
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
                    <td colSpan={8} className="center-text">
                      No headcount uploaded for this branch yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="cardhead">
            <h2>Optimum changes</h2>
          </div>
          <ul className="log">
            {d.requests.map((r: any) => (
              <li key={r.id}>
                <div className="row">
                  <span className={`pill ${r.status}`}>{r.status}</span>
                  <span>{ROLES.map((k) => `${ROLE_SHORT[k]} ${r[k]}`).join(" · ")}</span>
                </div>
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
    </div>
  );
}
