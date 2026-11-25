import * as XLSX from "xlsx";
import type { RoleKey } from "./calc";

export type ParsedRow = { location: string } & Record<RoleKey | "other", number>;
export type Parsed = { periodLabel: string; employees: number; rows: ParsedRow[] };

const ROLE_MAP: Record<string, RoleKey> = {
  "store manager": "sm",
  "team leader": "tl",
  barista: "ba",
  cashier: "ca",
  cleaner: "cl",
};

/**
 * Reads the weekly Headcount workbook ("Data" sheet: one row per employee)
 * and counts active employees per Matrix Location and role.
 */
export async function parseHeadcountFile(file: File): Promise<Parsed> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === "data");
  if (!sheetName) throw new Error('Could not find a sheet named "Data" in this file.');
  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[sheetName], { defval: null });
  if (!data.length) throw new Error("The Data sheet is empty.");

  const cols = Object.keys(data[0]);
  const find = (...names: string[]) => cols.find((c) => names.includes(c.trim().toLowerCase()));
  const locCol = find("matrix location");
  const roleCol = find("role group");
  const titleCol = find("title");
  const statusCol = find("current employee status", "status");
  if (!locCol) throw new Error('Missing "Matrix Location" column in the Data sheet.');
  if (!roleCol && !titleCol) throw new Error('Missing "Role Group" or "Title" column in the Data sheet.');

  const byLoc = new Map<string, ParsedRow>();
  let employees = 0;
  for (const r of data) {
    const loc = String(r[locCol] ?? "").trim();
    if (!loc) continue;
    if (statusCol && r[statusCol] && String(r[statusCol]).trim().toLowerCase() !== "active") continue;
    employees++;
    const roleText = String((roleCol && r[roleCol]) || (titleCol && r[titleCol]) || "").trim().toLowerCase();
    const role = ROLE_MAP[roleText] ?? "other";
    const row = byLoc.get(loc) ?? { location: loc, sm: 0, tl: 0, ba: 0, ca: 0, cl: 0, other: 0 };
    row[role]++;
    byLoc.set(loc, row);
  }

  // Period label: Summary!B2 "Period: 15 Nov to 21 Nov 2026 · ..." or the file name
  let periodLabel = file.name.replace(/\.xlsx?$/i, "").replace(/[_]+/g, " ").trim();
  const summary = wb.Sheets[wb.SheetNames.find((n) => n.trim().toLowerCase() === "summary") ?? ""];
  const b2 = summary?.["B2"]?.v;
  if (typeof b2 === "string") {
    const m = b2.match(/Period:\s*([^·|]+)/i);
    if (m) periodLabel = m[1].trim();
  }
  return { periodLabel, employees, rows: [...byLoc.values()].sort((a, b) => a.location.localeCompare(b.location)) };
}

// ---------- location → branch matching ----------
const SYN: Record<string, string> = {
  mecca: "makkah", mec: "makkah", mkk: "makkah", makka: "makkah",
  madina: "madinah", medina: "madinah", med: "madinah",
  riy: "riyadh", ryd: "riyadh", jed: "jeddah", jeaddh: "jeddah",
  tbu: "tabuk", abh: "abha", ahs: "hasa", dmm: "dammam", kbr: "khobar",
  jizan: "jazan", buraidah: "buraydah", burydah: "buraydah",
  oalya: "ulaya", olaya: "ulaya", walayda: "walyal", tiaba: "taiba", soudah: "soudah",
};
// Generic words (cities, regions, facility words) never count as a match on their own
const STOP = new Set([
  "b", "rd", "road", "st", "dt", "the", "al", "branch", "br", "dist", "street",
  "riyadh", "jeddah", "makkah", "madinah", "tabuk", "abha", "hasa", "dammam", "khobar", "jazan", "buraydah",
  "taif", "hail", "sakaka", "khamis", "najran", "qassim", "unaizah", "yanbu", "jubail", "hofuf",
  "head", "office", "hq", "prince", "king", "airport", "mall", "haram", "gate", "production", "factory", "warehouse", "center", "centre", "training",
]);

export const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/^\s*\d+\s*:/, " ")
      .replace(/(^|[^a-z])b\d+/g, " ")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .split(/[^a-z0-9\u0600-\u06ff]+/)
      .map((t) => SYN[t] ?? t)
      .filter((t) => t && !STOP.has(t) && (t.length > 1 || /\d/.test(t))),
  );

export function codeFromLocation(loc: string) {
  const m = loc.match(/(?:^|[^a-z])B\s?0*(\d{1,3})(?!\d)/i);
  return m ? `B${m[1].padStart(2, "0")}` : null;
}

/** Suggest a branch only when distinctive words match well in both directions. */
export function suggestBranch(loc: string, branches: { code: string; name: string; city: string | null }[]) {
  const lt = tokens(loc);
  const words = [...lt].filter((t) => !/^\d+$/.test(t));
  if (!words.length) return null;
  let best: { code: string; score: number } | null = null;
  let tie = false;
  for (const b of branches) {
    const bt = tokens(b.name);
    let inter = 0, wordHit = 0;
    for (const t of lt) if (bt.has(t)) { inter++; if (!/^\d+$/.test(t)) wordHit++; }
    if (!wordHit) continue;
    // a number in either name (e.g. "Walyal 2") must agree
    const ln = [...lt].filter((t) => /^\d+$/.test(t)), bn = [...bt].filter((t) => /^\d+$/.test(t));
    if (ln.length && bn.length && !ln.some((n) => bn.includes(n))) continue;
    const score = inter / Math.max(lt.size, 1) + inter / Math.max(bt.size, 1) / 2;
    if (!best || score > best.score) { best = { code: b.code, score }; tie = false; }
    else if (score === best.score) tie = true;
  }
  return best && !tie && best.score >= 0.75 ? best.code : null;
}
