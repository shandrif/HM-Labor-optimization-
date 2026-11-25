import { useEffect, useMemo, useState } from "react";
import { api, cachedApi, type User } from "../api";
import { compute, fmt, fmtPct, fmtSar, fmtSigned, planDeltas, ROLES, ROLE_SHORT, totals, type BranchRow, type Computed } from "../calc";
import { Icon, PageSkeleton } from "../ui";

type SortKey = "code" | "name" | "region" | "ads" | "actual" | "optimum" | "gap" | "projGap" | "actProd" | "optProd" | "change";
type Filters = { q: string; region: string; am: string; ops: string; tier: string; type: string; status: string };
const EMPTY: Filters = { q: "", region: "", am: "", ops: "", tier: "", type: "", status: "" };
const STORE = "hm.dashboard.v1";

function load<T>(fallback: T): T {
  try {
    const v = sessionStorage.getItem(STORE);
    return v ? { ...fallback, ...JSON.parse(v) } : fallback;
  } catch {
    return fallback;
  }
}

const tone = (n: number | null | undefined) => (n == null || n === 0 ? "" : n > 0 ? "over" : "short");
const gapTone = (n: number) => (n > 0 ? "short" : n < 0 ? "over" : "ok");

export function Delta({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  if (value == null) return null;
  const cls = value > 0.0005 ? "up" : value < -0.0005 ? "down" : "zero";
  return (
    <span className={`delta ${cls}`}>
      {fmtPct(value)}
      {suffix}
    </span>
  );
}

export default function Dashboard({ user }: { user: User }) {
  const [data, setData] = useState<{ upload: any; branches: BranchRow[]; actions: any[] } | null>(null);
  const [error, setError] = useState("");
  const [state, setState] = useState(() => load({ f: EMPTY, sort: { key: "change" as SortKey, dir: -1 as 1 | -1 } }));
  const { f, sort } = state;
  const setF = (patch: Partial<Filters>) => setState((s) => ({ ...s, f: { ...s.f, ...patch } }));

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [state]);

  useEffect(() => {
    cachedApi("/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  const all = useMemo(() => {
    const d = planDeltas(data?.actions ?? []);
    return (data?.branches ?? []).map((b) => compute(b, d.get(b.code)));
  }, [data]);
  const opts = (k: keyof BranchRow) => [...new Set(all.map((b) => b[k]).filter(Boolean) as string[])].sort();

  const rows = useMemo(() => {
    const ql = f.q.trim().toLowerCase();
    const out = all.filter(
      (b) =>
        (!ql || `${b.code} ${b.name} ${b.city} ${b.area_manager}`.toLowerCase().includes(ql)) &&
        (!f.region || b.region === f.region) &&
        (!f.am || b.area_manager === f.am) &&
        (!f.ops || b.ops_lead === f.ops) &&
        (!f.tier || b.size_tier === f.tier) &&
        (!f.type || b.store_type === f.type) &&
        (!f.status ||
          (f.status === "over" && b.hasActual && b.gap < 0) ||
          (f.status === "under" && b.hasActual && b.gap > 0) ||
          (f.status === "ok" && b.hasActual && b.gap === 0) ||
          (f.status === "open" && b.hasActual && b.hasOptimum && b.projGap !== 0) ||
          (f.status === "nodata" && (!b.hasActual || !b.hasOptimum || !b.ads)) ||
          (f.status === "pending" && b.pending > 0)),
    );
    const k = sort.key;
    return out.sort((a, b) => {
      const av = a[k] as any, bv = b[k] as any;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (typeof av === "string" ? av.localeCompare(bv) : av - bv) * sort.dir;
    });
  }, [all, f, sort]);

  const t = useMemo(() => totals(rows), [rows]);
  const filtered = Object.values(f).some(Boolean);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <PageSkeleton kpis={5} />;

  const th = (key: SortKey, label: string, cls = "") => (
    <th
      className={`sortable ${cls} ${sort.key === key ? "active" : ""} ${sort.key === key && sort.dir === 1 ? "asc" : ""}`}
      onClick={() =>
        setState((s) => ({
          ...s,
          sort: { key, dir: s.sort.key === key ? (s.sort.dir === 1 ? -1 : 1) : ["code", "name", "region"].includes(key) ? 1 : -1 },
        }))
      }
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
    >
      {label}
      <span className="arrow">↓</span>
    </th>
  );

  const exportXlsx = async () => {
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
      ...Object.fromEntries(ROLES.map((r) => [`Actual ${ROLE_SHORT[r]}`, b[`act_${r}`] ?? null])),
      "Actual HC": b.hasActual ? b.actual : null,
      ...Object.fromEntries(ROLES.map((r) => [`Optimum ${ROLE_SHORT[r]}`, b[`opt_${r}`] ?? null])),
      "Optimum HC": b.hasOptimum ? b.optimum : null,
      "Net Req": b.hasActual && b.hasOptimum ? b.gap : null,
      "Planned actions": b.planned,
      "Gap after actions": b.hasActual && b.hasOptimum ? b.projGap : null,
      "Actual Prod/Head": b.actProd ? Math.round(b.actProd) : null,
      "Optimum Prod/Head": b.optProd ? Math.round(b.optProd) : null,
      "Change %": b.change != null ? Math.round(b.change * 1000) / 10 : null,
    }));
    if (!out.length) return;
    // loaded on demand: keeps the Excel writer out of the initial download
    const { default: writeXlsxFile } = await import("write-excel-file");
    const headers = Object.keys(out[0]);
    const data = [
      headers.map((h) => ({ value: h, fontWeight: "bold" as const })),
      ...out.map((r) =>
        headers.map((h) => {
          const v = (r as Record<string, unknown>)[h];
          return v == null ? null : typeof v === "number" ? { type: Number, value: v } : { type: String, value: String(v) };
        }),
      ),
    ];
    await writeXlsxFile(data as any, { fileName: `labor-optimization-${new Date().toISOString().slice(0, 10)}.xlsx` });
  };

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">
            {data.upload ? `Headcount · ${data.upload.period_label}` : "No headcount uploaded yet"}
          </div>
          <h1>Labor productivity</h1>
          <p>Sales per head at actual vs optimum staffing, across {all.length} branches.</p>
        </div>
        <div className="headactions">
          <button className="ghost" onClick={exportXlsx}>
            <Icon name="download" />
            Export
          </button>
        </div>
      </div>

      <section className="kpis">
        <div className="kpi accent">
          <div className="label">Optimum productivity / head</div>
          <div className="value">{fmtSar(t.optProd)}</div>
          <div className="sub">
            <Delta value={t.change} /> vs actual {fmtSar(t.actProd)} SAR
          </div>
        </div>
        <div className="kpi">
          <div className="label">Actual headcount</div>
          <div className="value">{fmt(t.actual)}</div>
          <div className="sub">Budget {fmt(t.budget)}</div>
        </div>
        <div className="kpi">
          <div className="label">Optimum headcount</div>
          <div className="value">{fmt(t.optimum)}</div>
          <div className="sub">
            <span className={`delta ${t.gap > 0 ? "down" : t.gap < 0 ? "up" : "zero"}`}>{fmtSigned(t.gap)}</span>
            {t.gap > 0 ? "needed" : t.gap < 0 ? "surplus" : "balanced"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Gap after actions</div>
          <div className={`value ${gapTone(t.projGap)}`}>{fmtSigned(t.projGap)}</div>
          <div className="sub">
            {data.actions.length
              ? `${data.actions.length} approved action${data.actions.length === 1 ? "" : "s"} · net ${fmtSigned(t.planned)}`
              : "No approved actions"}
          </div>
        </div>
      </section>

      <section className="card flush reveal">
        <div className="cardhead">
          <div>
            <h2>Headcount by role</h2>
            <div className="sub">{filtered ? `${rows.length} branches match your filters` : "All branches"}</div>
          </div>
        </div>
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
              <tr className="sep">
                <td>Net requirement</td>
                {ROLES.map((r) => {
                  const g = t.byRole[r].optimum - t.byRole[r].actual;
                  return (
                    <td key={r} className={`num b ${gapTone(g)}`}>
                      {fmtSigned(g)}
                    </td>
                  );
                })}
                <td className={`num b ${gapTone(t.gap)}`}>{fmtSigned(t.gap)}</td>
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
                    <td key={r} className={`num b ${gapTone(g)}`}>
                      {fmtSigned(g)}
                    </td>
                  );
                })}
                <td className={`num b ${gapTone(t.projGap)}`}>{fmtSigned(t.projGap)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="legend" style={{ padding: "0 24px 20px" }}>
          <span>
            <i style={{ background: "var(--short)" }} /> Staff needed
          </span>
          <span>
            <i style={{ background: "var(--over)" }} /> Surplus
          </span>
          <span>
            <i style={{ background: "var(--ok)" }} /> Balanced
          </span>
          <span>Net requirement = Optimum − Actual</span>
        </div>
      </section>

      <section className="card flush reveal">
        <div className="toolbar">
          <div className="filters">
            <div className="search">
              <Icon name="search" />
              <input placeholder="Search branch, code, city, manager" value={f.q} onChange={(e) => setF({ q: e.target.value })} />
            </div>
            <Select value={f.region} onChange={(v) => setF({ region: v })} label="All regions" options={opts("region")} />
            <Select value={f.am} onChange={(v) => setF({ am: v })} label="All area managers" options={opts("area_manager")} />
            <Select value={f.ops} onChange={(v) => setF({ ops: v })} label="All ops leads" options={opts("ops_lead")} />
            <Select value={f.tier} onChange={(v) => setF({ tier: v })} label="All tiers" options={opts("size_tier")} />
            <Select value={f.type} onChange={(v) => setF({ type: v })} label="DT & NDT" options={opts("store_type")} />
            <select value={f.status} onChange={(e) => setF({ status: e.target.value })}>
              <option value="">Any status</option>
              <option value="over">Surplus</option>
              <option value="under">Staff needed</option>
              <option value="ok">On optimum</option>
              <option value="open">Gap after actions</option>
              <option value="pending">Pending request</option>
              <option value="nodata">Missing data</option>
            </select>
          </div>
          <div className="meta">
            <span>
              {rows.length} of {all.length} branches
            </span>
            {filtered && (
              <button className="linkbtn" onClick={() => setF(EMPTY)}>
                Clear filters
              </button>
            )}
          </div>
        </div>
        <div className="tablewrap tall">
          <table className="grid">
            <thead>
              <tr>
                {th("name", "Branch")}
                {th("region", "Region")}
                {th("ads", "ADS", "num")}
                {th("actual", "Actual", "num")}
                {th("optimum", "Optimum", "num")}
                {th("gap", "Net req", "num")}
                {th("projGap", "After actions", "num")}
                {th("actProd", "Actual / head", "num")}
                {th("optProd", "Optimum / head", "num")}
                {th("change", "Change", "num")}
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <Row key={b.code} b={b} />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={11} className="center-text">
                    No branches match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {user.role === "viewer" && <p className="muted small">You have view-only access.</p>}
    </div>
  );
}

function Row({ b }: { b: Computed }) {
  const go = () => (window.location.hash = `/branch/${encodeURIComponent(b.code)}`);
  return (
    <tr className="click" onClick={go}>
      <td>
        <div className="branchcell">
          <span className="code">{b.code}</span>
          <div>
            <div className="name">
              {b.name}
              {b.pending > 0 && <span className="pill warn inline-pill">Pending</span>}
            </div>
            <div className="sub">
              {[b.city, b.size_tier && `Tier ${b.size_tier}`, b.store_type].filter(Boolean).join(" · ")}
            </div>
          </div>
        </div>
      </td>
      <td className="muted">{b.region}</td>
      <td className="num">{b.ads ? fmt(b.ads) : "—"}</td>
      <td className="num">{b.hasActual ? b.actual : "—"}</td>
      <td className="num">{b.hasOptimum ? b.optimum : "—"}</td>
      <td className={`num b ${b.hasActual && b.hasOptimum ? gapTone(b.gap) : ""}`}>
        {b.hasActual && b.hasOptimum ? fmtSigned(b.gap) : "—"}
      </td>
      <td className={`num ${b.hasActual && b.hasOptimum ? gapTone(b.projGap) : ""}`} title={b.planned ? `Planned ${fmtSigned(b.planned)}` : ""}>
        {b.hasActual && b.hasOptimum ? (b.projGap === 0 ? "✓" : fmtSigned(b.projGap)) : "—"}
      </td>
      <td className="num">{fmtSar(b.actProd)}</td>
      <td className="num">{fmtSar(b.optProd)}</td>
      <td className={`num b ${tone(b.change)}`}>{fmtPct(b.change)}</td>
      <td className="num" style={{ width: 28 }}>
        <span className="rowgo">
          <Icon name="chevron" className="" />
        </span>
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
