import { useEffect, useState } from "react";
import { api, type User } from "../api";
import { dialog, initials, Icon, toast } from "../ui";

const ROLE_HELP = {
  admin: "Everything, incl. approvals, uploads and users",
  manager: "View all, request optimum changes",
  viewer: "View only",
};

export default function Users({ user }: { user: User }) {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ username: "", name: "", role: "viewer", password: "" });
  const [error, setError] = useState("");

  const load = () => api("/users").then((r) => setList(r.users)).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<any>, ok: string) => {
    try {
      await fn();
      toast(ok);
      load();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    }
  };

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <div className="eyebrow">{list.length} people</div>
          <h1>Users</h1>
          <p>Admins approve changes, upload headcount and manage access. Managers propose changes. Viewers read only.</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <section className="card">
        <div className="cardhead">
          <h2>Add user</h2>
        </div>
        <form
          className="formgrid"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api("/users", { method: "POST", json: form }), `${form.name || form.username} added`).then(
              (ok) => ok && setForm({ username: "", name: "", role: "viewer", password: "" }),
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
          <div className="actions" style={{ alignSelf: "end", marginBottom: 16 }}>
            <button className="primary">
              <Icon name="plus" />
              Add user
            </button>
          </div>
        </form>
      </section>
      <section className="card flush reveal">
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
                  <td>
                    <div className="branchcell" style={{ minWidth: 0 }}>
                      <span className="avatar">{initials(u.name)}</span>
                      <span className="name">{u.name}</span>
                    </div>
                  </td>
                  <td className="mono">{u.username}</td>
                  <td>
                    <select
                      value={u.role}
                      disabled={u.id === user.id}
                      onChange={(e) => run(() => api(`/users/${u.id}`, { method: "PATCH", json: { role: e.target.value } }), "Role updated")}
                    >
                      <option>admin</option>
                      <option>manager</option>
                      <option>viewer</option>
                    </select>
                  </td>
                  <td>{u.active ? <span className="pill active">Active</span> : <span className="pill disabled">Disabled</span>}</td>
                  <td>
                    <div className="rowactions">
                    <button
                      className="ghost sm"
                      onClick={async () => {
                        const p = await dialog.prompt({
                          title: `Reset password for ${u.name}`,
                          message: "They will be signed out everywhere and need the new password to sign in.",
                          label: "New password (min 8 characters)",
                          type: "text",
                          required: true,
                          confirmLabel: "Reset password",
                        });
                        if (p) run(() => api(`/users/${u.id}`, { method: "PATCH", json: { password: p } }), "Password reset");
                      }}
                    >
                      Reset password
                    </button>
                    {u.id !== user.id && (
                      <button
                        className="ghost sm"
                        onClick={async () => {
                          if (
                            u.active &&
                            !(await dialog.confirm({
                              title: `Disable ${u.name}?`,
                              message: "They will be signed out and cannot sign in until re-enabled.",
                              confirmLabel: "Disable",
                              danger: true,
                            }))
                          )
                            return;
                          run(() => api(`/users/${u.id}`, { method: "PATCH", json: { active: !u.active } }), u.active ? "User disabled" : "User enabled");
                        }}
                      >
                        {u.active ? "Disable" : "Enable"}
                      </button>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
