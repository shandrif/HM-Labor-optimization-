export const ROLES = ["sm", "tl", "ba", "ca", "cl"] as const;
export type RoleKey = (typeof ROLES)[number];
export const ROLE_LABEL: Record<RoleKey, string> = {
  sm: "Store Manager",
  tl: "Team Leader",
  ba: "Barista",
  ca: "Cashier",
  cl: "Cleaner",
};
export const ROLE_SHORT: Record<RoleKey, string> = { sm: "SM", tl: "TL", ba: "BA", ca: "CA", cl: "CL" };

export type BranchRow = {
  code: string;
  name: string;
  region: string | null;
  city: string | null;
  area_manager: string | null;
  ops_lead: string | null;
  working_hours: number | null;
  ads: number;
  atc: number;
  size_tier: string | null;
  store_type: string | null;
  floors: number | null;
  toilets: number | null;
  pending: number;
  act_other: number | null;
} & { [K in `budget_${RoleKey}` | `opt_${RoleKey}` | `act_${RoleKey}`]: number | null };

export const sumRoles = (b: BranchRow, prefix: "budget" | "opt" | "act") =>
  ROLES.reduce((s, r) => s + (Number(b[`${prefix}_${r}`]) || 0), 0);

export type Computed = BranchRow & {
  budget: number;
  actual: number;
  optimum: number;
  hasActual: boolean;
  hasOptimum: boolean;
  gap: number; // optimum - actual: + needs staff, - surplus
  actProd: number | null; // ADS / actual headcount
  optProd: number | null; // ADS / optimum headcount
  change: number | null; // optProd / actProd - 1
};

/**
 * Productivity per head = ADS / headcount (SM+TL+BA+CA+CL).
 * Change % = Optimum productivity / Actual productivity - 1.
 *   ▲ positive → branch is over-staffed (optimum raises sales per head)
 *   ▼ negative → branch is under-staffed
 */
export function compute(b: BranchRow): Computed {
  const actual = sumRoles(b, "act");
  const optimum = sumRoles(b, "opt");
  const hasActual = b.act_sm != null;
  const hasOptimum = b.opt_sm != null;
  const ads = Number(b.ads) || 0;
  const actProd = hasActual && actual > 0 && ads > 0 ? ads / actual : null;
  const optProd = hasOptimum && optimum > 0 && ads > 0 ? ads / optimum : null;
  return {
    ...b,
    budget: sumRoles(b, "budget"),
    actual,
    optimum,
    hasActual,
    hasOptimum,
    gap: optimum - actual,
    actProd,
    optProd,
    change: actProd && optProd ? optProd / actProd - 1 : null,
  };
}

export function totals(rows: Computed[]) {
  const t = { budget: 0, actual: 0, optimum: 0, ads: 0, adsActualHC: 0, adsOptimumHC: 0 };
  const byRole = Object.fromEntries(ROLES.map((r) => [r, { budget: 0, actual: 0, optimum: 0 }])) as Record<
    RoleKey,
    { budget: number; actual: number; optimum: number }
  >;
  for (const b of rows) {
    t.budget += b.budget;
    t.actual += b.actual;
    t.optimum += b.optimum;
    // productivity totals only use branches that have sales and both headcounts
    if (b.actProd != null && b.optProd != null) {
      t.ads += Number(b.ads);
      t.adsActualHC += b.actual;
      t.adsOptimumHC += b.optimum;
    }
    for (const r of ROLES) {
      byRole[r].budget += Number(b[`budget_${r}`]) || 0;
      byRole[r].actual += Number(b[`act_${r}`]) || 0;
      byRole[r].optimum += Number(b[`opt_${r}`]) || 0;
    }
  }
  const actProd = t.adsActualHC ? t.ads / t.adsActualHC : null;
  const optProd = t.adsOptimumHC ? t.ads / t.adsOptimumHC : null;
  return {
    ...t,
    gap: t.optimum - t.actual,
    actProd,
    optProd,
    change: actProd && optProd ? optProd / actProd - 1 : null,
    byRole,
  };
}

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmt = (n: number | null | undefined) => (n == null ? "—" : nf0.format(n));
export const fmtSar = (n: number | null | undefined) => (n == null ? "—" : `${nf0.format(n)}`);
export const fmtPct = (n: number | null | undefined) =>
  n == null ? "—" : `${n > 0 ? "▲ +" : n < 0 ? "▼ " : ""}${nf1.format(n * 100)}%`;
export const fmtSigned = (n: number) => (n > 0 ? `+${n}` : `${n}`);
