import { useEffect, useState } from "react";
import { api, type User } from "../api";

const ROLE_HELP = {
  admin: "Everything, incl. approvals, uploads and users",
  manager: "View all, request optimum changes",
  viewer: "View only",
};

export default function Users({ user }: { user: User }) {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ username: "", name: "", role: "viewer", password: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = () => api("/users").then((r) => setList(r.users)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setError("");
    setMsg("");
    try {
      await fn();
      setMsg(ok);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Users</h1>
          <p className="muted">Only Admin can approve optimum changes, upload headcount and manage users.</p>
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}
      <section className="card">
        <h2>Add user</h2>
        <form
          className="formgrid"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api("/users", { method: "POST", json: form }), `User ${form.username} created.`).then(() =>
              setForm({ username: "", name: "", role: "viewer", password: "" }),
            );
          }}
        >
          <label>
            Full name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>
            Username
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_HELP).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} — {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temporary password (min 8)
            <input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <div className="actions">
            <button className="primary">Create user</button>
          </div>
        </form>
      </section>
      <section className="card">
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="mono">{u.username}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === user.id}
                      onChange={(e) => run(() => api(`/users/${u.id}`, { method: "PATCH", json: { role: e.target.value } }), "Role updated.")}
                    >
                      <option>admin</option>
                      <option>manager</option>
                      <option>viewer</option>
                    </select>
                  </td>
                  <td>{u.active ? <span className="pill approved">active</span> : <span className="pill rejected">disabled</span>}</td>
                  <td className="nowrap">
                    <button
                      className="ghost sm"
                      onClick={() => {
                        const p = prompt(`New password for ${u.username} (min 8 characters)`);
                        if (p) run(() => api(`/users/${u.id}`, { method: "PATCH", json: { password: p } }), "Password reset.");
                      }}
                    >
                      Reset password
                    </button>{" "}
                    {u.id !== user.id && (
                      <button
                        className="ghost sm"
                        onClick={() =>
                          run(() => api(`/users/${u.id}`, { method: "PATCH", json: { active: !u.active } }), u.active ? "User disabled." : "User enabled.")
                        }
                      >
                        {u.active ? "Disable" : "Enable"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
