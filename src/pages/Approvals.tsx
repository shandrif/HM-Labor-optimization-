import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { fmtPct, fmtSar, ROLES, ROLE_SHORT } from "../calc";
import { dialog, PageSkeleton, toast } from "../ui";

export default function Approvals({ user }: { user: User }) {
  const [status, setStatus] = useState("pending");
  const [list, setList] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const isAdmin = user.role === "admin";

  const load = () =>
    api(`/requests?status=${status}`)
      .then((r) => setList(r.requests))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [status]);

  const decide = async (id: number, decision: "approve" | "reject") => {
    let note = "";
    if (decision === "reject") {
      const p = await dialog.prompt({ title: "Reject this change?", label: "Reason (optional)", confirmLabel: "Reject", danger: true });
      if (p === null) return;
      note = p;
    }
    try {
      await api(`/requests/${id}/${decision}`, { method: "POST", json: { note } });
      toast(decision === "approve" ? "Optimum change approved" : "Change rejected");
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const tot = (r: any, p = "") => ROLES.reduce((s, k) => s + (Number(r[p + k]) || 0), 0);

  if (error) return <div className="error">{error}</div>;
  if (!list) return <PageSkeleton kpis={0} />;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1>{isAdmin ? "Optimum approvals" : "Optimum change requests"}</h1>
          <p>
            {isAdmin
              ? "Changes to optimum headcount requested by managers. Only Admin can approve."
              : "Your requests are reviewed by Admin."}
          </p>
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      <section className="card flush">
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Change (from → to)</th>
                <th className="num">Total</th>
                <th className="num">Optimum prod/head</th>
                <th>Requested</th>
                <th>Reason</th>
                <th>Status</th>
                {isAdmin && status === "pending" && <th></th>}
              </tr>
            </thead>
            <tbody>
              {list?.map((r) => {
                const before = tot(r, "prev_"), after = tot(r);
                const pb = before && r.ads ? r.ads / before : null, pa = after && r.ads ? r.ads / after : null;
                return (
                  <tr key={r.id}>
                    <td>
                      <a href={`#/branch/${encodeURIComponent(r.branch_code)}`}>
                        <span className="branchcell"><span className="code">{r.branch_code}</span>{r.branch_name}</span>
                      </a>
                    </td>
                    <td className="small">
                      {ROLES.filter((k) => r[k] !== r[`prev_${k}`]).map((k) => (
                        <span key={k} className="chg">
                          {ROLE_SHORT[k]} {r[`prev_${k}`] ?? "—"}→{r[k]}
                        </span>
                      ))}
                      {ROLES.every((k) => r[k] === r[`prev_${k}`]) && <span className="muted">no change</span>}
                    </td>
                    <td className="num">
                      {before}→<b>{after}</b>
                    </td>
                    <td className="num">
                      {fmtSar(pb)}→<b>{fmtSar(pa)}</b> <span className="muted small">{pb && pa ? fmtPct(pa / pb - 1) : ""}</span>
                    </td>
                    <td className="small">
                      {r.requested_by_name}
                      <div className="muted">{r.created_at?.slice(0, 16)}</div>
                    </td>
                    <td className="small">{r.reason || <span className="muted">—</span>}</td>
                    <td>
                      <span className={`pill ${r.status}`}>{r.status}</span>
                      {r.review_note && <div className="muted small">{r.review_note}</div>}
                    </td>
                    {isAdmin && status === "pending" && (
                      <td>
                        <div className="rowactions">
                          <button className="primary sm" onClick={() => decide(r.id, "approve")}>
                            Approve
                          </button>
                          <button className="ghost sm" onClick={() => decide(r.id, "reject")}>
                            Reject
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
              {list && !list.length && (
                <tr>
                  <td colSpan={8} className="center-text">
                    {status === "pending" ? "You're all caught up — nothing waiting for review." : "Nothing here."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
