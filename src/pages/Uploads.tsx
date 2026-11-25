import { useEffect, useMemo, useState } from "react";
import { api, type User } from "../api";
import { fmt, ROLES, ROLE_SHORT } from "../calc";
import { dialog, Icon, PageSkeleton, toast } from "../ui";
import { codeFromLocation, parseHeadcountFile, suggestBranch, type Parsed } from "../headcountParser";

type Branch = { code: string; name: string; city: string | null };
type Source = "saved" | "code" | "suggested" | "none";

export default function Uploads({ user }: { user: User }) {
  const isAdmin = user.role === "admin";
  const [uploads, setUploads] = useState<any[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saved, setSaved] = useState<Map<string, string | null>>(new Map());
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [label, setLabel] = useState("");
  const [map, setMap] = useState<Record<string, string | null>>({});
  const [src, setSrc] = useState<Record<string, Source>>({});
  const [onlyReview, setOnlyReview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState("");

  const load = () => {
    api("/uploads").then((r) => setUploads(r.uploads)).catch((e) => setError(e.message));
    if (isAdmin) {
      api("/dashboard").then((r) => setBranches(r.branches));
      api("/location-map").then((r) => setSaved(new Map(r.map.map((m: any) => [m.location, m.branch_code]))));
    }
  };
  useEffect(load, []);

  const onFile = async (f: File | null) => {
    setFile(f);
    setParsed(null);
    setError("");
    if (!f) return;
    try {
      const p = await parseHeadcountFile(f);
      const codes = new Set(branches.map((b) => b.code));
      const m: Record<string, string | null> = {};
      const s: Record<string, Source> = {};
      for (const r of p.rows) {
        const fromCode = codeFromLocation(r.location);
        if (saved.has(r.location)) {
          m[r.location] = saved.get(r.location)!;
          s[r.location] = "saved";
        } else if (fromCode && codes.has(fromCode)) {
          m[r.location] = fromCode;
          s[r.location] = "code";
        } else {
          const sug = suggestBranch(r.location, branches);
          m[r.location] = sug;
          s[r.location] = sug ? "suggested" : "none";
        }
      }
      setParsed(p);
      setLabel(p.periodLabel);
      setMap(m);
      setSrc(s);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const summary = useMemo(() => {
    if (!parsed) return null;
    const used = new Map<string, number>();
    let mapped = 0, staff = 0;
    for (const r of parsed.rows) {
      const c = map[r.location];
      if (!c) continue;
      mapped++;
      staff += ROLES.reduce((s, k) => s + r[k], 0);
      used.set(c, (used.get(c) ?? 0) + 1);
    }
    const missing = branches.filter((b) => !used.has(b.code));
    const dup = [...used].filter(([, n]) => n > 1).map(([c]) => c);
    return { mapped, staff, missing, dup };
  }, [parsed, map, branches]);

  const submit = async () => {
    if (!parsed || !file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append(
        "payload",
        JSON.stringify({ period_label: label, employees: parsed.employees, rows: parsed.rows, mappings: map, staff: parsed.staff }),
      );
      const r = await api("/uploads", { method: "POST", body: fd });
      toast(`Headcount saved — ${r.branches} branches updated`);
      setParsed(null);
      setFile(null);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    const ok = await dialog.confirm({
      title: "Delete this upload?",
      message: "The dashboard will fall back to the previous headcount. The stored file is deleted too.",
      confirmLabel: "Delete upload",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/uploads/${id}`, { method: "DELETE" });
      toast("Upload deleted");
    } catch (e: any) {
      toast.error(e.message);
    }
    load();
  };

  const visible = parsed?.rows.filter((r) => !onlyReview || src[r.location] === "suggested" || src[r.location] === "none") ?? [];

  if (!uploads) return error ? <div className="error">{error}</div> : <PageSkeleton kpis={0} />;

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">{uploads[0] ? `Current · ${uploads[0].period_label}` : "No uploads yet"}</div>
          <h1>Headcount</h1>
          <p>
            The latest upload is the actual headcount used across the app.
            {isAdmin ? " Upload the weekly Headcount workbook (Excel with a “Data” sheet)." : " Only Admin can upload."}
          </p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {isAdmin && (
        <section className="card">
          <div className="cardhead">
            <h2>New upload</h2>
            {file && <span className="muted small">{file.name}</span>}
          </div>
          {!parsed && (
            <label
              className={`dropzone ${drag ? "drag" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                onFile(e.dataTransfer.files?.[0] ?? null);
              }}
            >
              <Icon name="file" />
              <b>Drop the headcount workbook here</b>
              <span className="small">or click to choose an .xlsx file</span>
              <input type="file" accept=".xlsx,.xls" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {parsed && summary && (
            <div className="panel">
              <div className="formgrid" style={{ marginTop: 0 }}>
                <label>
                  Period label
                  <input value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
              </div>
              <div className="stat-row">
                <span>
                  <b>{parsed.employees}</b> active employees
                </span>
                <span>
                  <b>{parsed.rows.length}</b> locations
                </span>
                <span>
                  <b>{summary.mapped}</b> mapped to branches
                </span>
                <span>
                  <b>{summary.staff}</b> branch staff
                </span>
              </div>
              {summary.dup.length > 0 && (
                <p className="warn-text small">Several locations map to: {summary.dup.join(", ")} — their staff will be added together.</p>
              )}
              {summary.missing.length > 0 && (
                <details className="small">
                  <summary className="warn-text">{summary.missing.length} branches get no headcount from this file</summary>
                  <p className="muted">{summary.missing.map((b) => `${b.code} ${b.name}`).join(" · ")}</p>
                </details>
              )}
              <label className="check" style={{ margin: "12px 0" }}>
                <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} />
                Show only locations that need review
              </label>
              <div className="tablewrap tall">
                <table className="grid">
                  <thead>
                    <tr>
                      <th>Location in file</th>
                      {ROLES.map((r) => (
                        <th key={r} className="num">
                          {ROLE_SHORT[r]}
                        </th>
                      ))}
                      <th className="num">Other</th>
                      <th>Branch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.location} className={src[r.location] === "suggested" ? "review" : ""}>
                        <td>{r.location}</td>
                        {ROLES.map((k) => (
                          <td key={k} className="num">
                            {r[k]}
                          </td>
                        ))}
                        <td className="num muted">{r.other}</td>
                        <td>
                          <select
                            value={map[r.location] ?? ""}
                            onChange={(e) => {
                              setMap({ ...map, [r.location]: e.target.value || null });
                              setSrc({ ...src, [r.location]: "saved" });
                            }}
                          >
                            <option value="">— Not a branch (ignore) —</option>
                            {branches.map((b) => (
                              <option key={b.code} value={b.code}>
                                {b.code} · {b.name}
                              </option>
                            ))}
                          </select>
                          {src[r.location] === "suggested" && <span className="pill warn inline-pill">Suggested</span>}
                        </td>
                      </tr>
                    ))}
                    {!visible.length && (
                      <tr>
                        <td colSpan={8} className="center-text">
                          Every location is matched.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="muted small" style={{ margin: "12px 0" }}>
                Your mapping choices are remembered for next week's upload.
              </p>
              <div className="actions">
                <button className="primary" disabled={busy || !label.trim()} onClick={submit}>
                  {busy ? "Uploading…" : "Save upload"}
                </button>
                <button className="ghost" onClick={() => onFile(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card flush reveal">
        <div className="cardhead">
          <h2>History</h2>
        </div>
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Branches</th>
                <th className="num">Branch staff</th>
                <th className="num">Employees in file</th>
                <th>Uploaded</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {uploads?.map((u, i) => (
                <tr key={u.id}>
                  <td>
                    {u.period_label} {i === 0 && <span className="pill approved inline-pill">Current</span>}
                  </td>
                  <td className="num">{u.branches}</td>
                  <td className="num">{fmt(u.branch_staff ?? 0)}</td>
                  <td className="num">{u.employees ? fmt(u.employees) : "—"}</td>
                  <td className="small">
                    {u.uploaded_by ?? "system"} · {u.created_at?.slice(0, 16)}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="rowactions">
                        {!!u.has_file && (
                          <a className="sm btn" href={`/api/uploads/${u.id}/file`}>
                            <Icon name="download" />
                            File
                          </a>
                        )}
                        <button className="quiet sm" onClick={() => del(u.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
