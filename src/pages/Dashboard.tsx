import { useEffect, useMemo, useState } from "react";
import { api, type User } from "../api";
import { compute, planDeltas, fmt, fmtPct, fmtSar, fmtSigned, ROLES, ROLE_SHORT, totals, type BranchRow, type Computed } from "../calc";
import * as XLSX from "xlsx";

type SortKey = "code" | "name" | "region" | "ads" | "actual" | "optimum" | "gap" | "projGap" | "actProd" | "optProd" | "change";

export default function Dashboard({ user }: { user: User }) {
  const [data, setData] = useState<{ upload: any; branches: BranchRow[]; actions: any[] } | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [region, setRegion] = useState("");
  const [am, setAm] = useState("");
  const [ops, setOps] = useState("");
  const [tier, setTier] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "change", dir: -1 });

  useEffect(() => {
    api("/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  const all = useMemo(() => {
    const d = planDeltas(data?.actions ?? []);
    return (data?.branches ?? []).map((b) => compute(b, d.get(b.code)));
  }, [data]);
  const opts = (k: keyof BranchRow) => [...new Set(all.map((b) => b[k]).filter(Boolean) as string[])].sort();

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const f = all.filter(
      (b) =>
        (!ql || `${b.code} ${b.name} ${b.city}`.toLowerCase().includes(ql)) &&
        (!region || b.region === region) &&
        (!am || b.area_manager === am) &&
        (!ops || b.ops_lead === ops) &&
        (!tier || b.size_tier === tier) &&
        (!type || b.store_type === type) &&
        (!status ||
          (status === "over" && b.hasActual && b.gap < 0) ||
          (status === "under" && b.hasActual && b.gap > 0) ||
          (status === "ok" && b.hasActual && b.gap === 0) ||
          (status === "open" && b.hasActual && b.hasOptimum && b.projGap !== 0) ||
          (status === "nodata" && (!b.hasActual || !b.hasOptimum || !b.ads)) ||
          (status === "pending" && b.pending > 0)),
    );
    const k = sort.key;
    return f.sort((a, b) => {
      const av = a[k] as any, bv = b[k] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    });
  }, [all, q, region, am, ops, tier, type, status, sort]);

  const t = useMemo(() => totals(rows), [rows]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const th = (key: SortKey, label: string, cls = "") => (
    <th
      className={`sortable ${cls}`}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "code" || key === "name" || key === "region" ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  const exportXlsx = () => {
    const out = rows.map((b) => ({
      Code: b.code,
      Branch: b.name,
      Region: b.region,
      City: b.city,
      "Area Manager": b.area_manager,
      Ops: b.ops_lead,
      Tier: b.size_tier,
      Type: b.store_type,
      ADS: Math.round(b.ads),
      ...Object.fromEntries(ROLES.map((r) => [`Actual ${ROLE_SHORT[r]}`, b[`act_${r}`] ?? ""])),
      "Actual HC": b.hasActual ? b.actual : "",
      ...Object.fromEntries(ROLES.map((r) => [`Optimum ${ROLE_SHORT[r]}`, b[`opt_${r}`] ?? ""])),
      "Optimum HC": b.hasOptimum ? b.optimum : "",
      "Net Req": b.hasActual && b.hasOptimum ? b.gap : "",
      "Planned actions": b.planned,
      "Gap after actions": b.hasActual && b.hasOptimum ? b.projGap : "",
      "Actual Prod/Head": b.actProd ? Math.round(b.actProd) : "",
      "Optimum Prod/Head": b.optProd ? Math.round(b.optProd) : "",
      "Change %": b.change != null ? Math.round(b.change * 1000) / 10 : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), "Branches");
    XLSX.writeFile(wb, `labor-optimization-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Labor productivity</h1>
          <p className="muted">
            Actual headcount from{" "}
            {data.upload ? (
              <b>
                {data.upload.period_label}
              </b>
            ) : (
              "— no upload yet"
            )}
            {data.upload && <> · uploaded {data.upload.created_at?.slice(0, 10)}</>} · Productivity/head = ADS ÷ headcount
          </p>
        </div>
        <button className="ghost" onClick={exportXlsx}>
          Export to Excel
        </button>
      </div>

      <section className="kpis">
        <div className="kpi">
          <div className="label">Branches</div>
          <div className="value">{rows.length}</div>
        </div>
        <div className="kpi">
          <div className="label">Actual headcount</div>
          <div className="value">{fmt(t.actual)}</div>
          <div className="sub">Budget {fmt(t.budget)}</div>
        </div>
        <div className="kpi">
          <div className="label">Optimum headcount</div>
          <div className="value">{fmt(t.optimum)}</div>
          <div className={`sub ${t.gap < 0 ? "over" : t.gap > 0 ? "short" : ""}`}>
            Net requirement {fmtSigned(t.gap)}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Actual productivity / head</div>
          <div className="value">{fmtSar(t.actProd)}</div>
          <div className="sub">SAR per day</div>
        </div>
        <div className="kpi">
          <div className="label">Optimum productivity / head</div>
          <div className="value">{fmtSar(t.optProd)}</div>
          <div className={`sub ${t.change && t.change > 0 ? "over" : t.change && t.change < 0 ? "short" : ""}`}>
            {fmtPct(t.change)} vs actual
          </div>
        </div>
      </section>

      <section className="card">
        <h2>By role</h2>
        <div className="tablewrap">
        <table className="roles">
          <thead>
            <tr>
              <th></th>
              {ROLES.map((r) => (
                <th key={r} className="num">
                  {ROLE_SHORT[r]}
                </th>
              ))}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {(["budget", "actual", "optimum"] as const).map((k) => (
              <tr key={k}>
                <td className="cap">{k}</td>
                {ROLES.map((r) => (
                  <td key={r} className="num">
                    {fmt(t.byRole[r][k])}
                  </td>
                ))}
                <td className="num b">{fmt(t[k])}</td>
              </tr>
            ))}
            <tr>
              <td>Net requirement</td>
              {ROLES.map((r) => {
                const g = t.byRole[r].optimum - t.byRole[r].actual;
                return (
                  <td key={r} className={`num b ${g > 0 ? "short" : g < 0 ? "over" : ""}`}>
                    {fmtSigned(g)}
                  </td>
                );
              })}
              <td className={`num b ${t.gap > 0 ? "short" : t.gap < 0 ? "over" : ""}`}>{fmtSigned(t.gap)}</td>
            </tr>
            <tr>
              <td>Planned actions</td>
              {ROLES.map((r) => (
                <td key={r} className="num">
                  {t.byRole[r].planned ? fmtSigned(t.byRole[r].planned) : "0"}
                </td>
              ))}
              <td className="num b">{t.planned ? fmtSigned(t.planned) : "0"}</td>
            </tr>
            <tr>
              <td>Gap after actions</td>
              {ROLES.map((r) => {
                const g = t.byRole[r].optimum - t.byRole[r].actual - t.byRole[r].planned;
                return (
                  <td key={r} className={`num b ${g > 0 ? "short" : g < 0 ? "over" : "ok"}`}>
                    {fmtSigned(g)}
                  </td>
                );
              })}
              <td className={`num b ${t.projGap > 0 ? "short" : t.projGap < 0 ? "over" : "ok"}`}>{fmtSigned(t.projGap)}</td>
            </tr>
          </tbody>
        </table>
        </div>
        <p className="muted small">Net requirement = Optimum − Actual. Positive: staff needed. Negative: surplus. Planned actions = approved
          transfers, promotions and hires not yet marked completed.</p>
      </section>

      <section className="card">
        <div className="filters">
          <input placeholder="Search branch, code, city…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={region} onChange={setRegion} label="All regions" options={opts("region")} />
          <Select value={am} onChange={setAm} label="All area managers" options={opts("area_manager")} />
          <Select value={ops} onChange={setOps} label="All ops leads" options={opts("ops_lead")} />
          <Select value={tier} onChange={setTier} label="All tiers" options={opts("size_tier")} />
          <Select value={type} onChange={setType} label="DT & NDT" options={opts("store_type")} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="over">Over-staffed</option>
            <option value="under">Under-staffed</option>
            <option value="ok">On optimum</option>
            <option value="open">Gap left after actions</option>
            <option value="pending">Pending request</option>
            <option value="nodata">Missing data</option>
          </select>
        </div>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                {th("code", "Code")}
                {th("name", "Branch")}
                {th("region", "Region")}
                <th>Tier</th>
                {th("ads", "ADS", "num")}
                {th("actual", "Actual HC", "num")}
                {th("optimum", "Optimum HC", "num")}
                {th("gap", "Net req", "num")}
                {th("projGap", "After actions", "num")}
                {th("actProd", "Actual prod/head", "num")}
                {th("optProd", "Optimum prod/head", "num")}
                {th("change", "Change", "num")}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <Row key={b.code} b={b} />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={12} className="muted center-text">
                    No branches match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {user.role === "viewer" && <p className="muted small">You have view-only access.</p>}
    </>
  );
}

function Row({ b }: { b: Computed }) {
  return (
    <tr className="click" onClick={() => (window.location.hash = `/branch/${encodeURIComponent(b.code)}`)}>
      <td className="mono">{b.code}</td>
      <td>
        {b.name}
        {b.pending > 0 && <span className="pill warn">pending</span>}
      </td>
      <td>{b.region}</td>
      <td>
        {b.size_tier}
        {b.store_type ? ` · ${b.store_type}` : ""}
      </td>
      <td className="num">{b.ads ? fmt(b.ads) : "—"}</td>
      <td className="num">{b.hasActual ? b.actual : "—"}</td>
      <td className="num">{b.hasOptimum ? b.optimum : "—"}</td>
      <td className={`num b ${b.gap > 0 ? "short" : b.gap < 0 ? "over" : ""}`}>
        {b.hasActual && b.hasOptimum ? fmtSigned(b.gap) : "—"}
      </td>
      <td className={`num ${b.projGap > 0 ? "short" : b.projGap < 0 ? "over" : "ok"}`} title={b.planned ? `Planned ${fmtSigned(b.planned)}` : ""}>
        {b.hasActual && b.hasOptimum ? (b.projGap === 0 ? "✓ 0" : fmtSigned(b.projGap)) : "—"}
      </td>
      <td className="num">{fmtSar(b.actProd)}</td>
      <td className="num">{fmtSar(b.optProd)}</td>
      <td className={`num b ${b.change && b.change > 0 ? "over" : b.change && b.change < 0 ? "short" : ""}`}>
        {fmtPct(b.change)}
      </td>
    </tr>
  );
}

function Select(p: { value: string; onChange: (v: string) => void; label: string; options: string[] }) {
  return (
    <select value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      <option value="">{p.label}</option>
      {p.options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}
