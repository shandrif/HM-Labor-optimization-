import { useState } from "react";
import { api, type User } from "../api";

export default function Account({ user }: { user: User }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Account</h1>
          <p className="muted">
            {user.name} · <span className="mono">{user.username}</span> · {user.role}
          </p>
        </div>
      </div>
      <section className="card narrow">
        <h2>Change password</h2>
        {msg && <div className="notice">{msg}</div>}
        {error && <div className="error">{error}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setMsg("");
            setError("");
            if (next !== confirm) return setError("New passwords do not match");
            try {
              await api("/me/password", { method: "POST", json: { current, next } });
              setMsg("Password changed.");
              setCurrent("");
              setNext("");
              setConfirm("");
            } catch (err: any) {
              setError(err.message);
            }
          }}
        >
          <label>
            Current password
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label>
            New password (min 8)
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label>
            Confirm new password
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button className="primary">Change password</button>
        </form>
      </section>
    </>
  );
}
