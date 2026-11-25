import { useState } from "react";
import { api, type User } from "../api";
import { initials, toast } from "../ui";

export default function Account({ user }: { user: User }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="page">
      <div className="pagehead">
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span className="avatar" style={{ width: 52, height: 52, fontSize: 18 }}>
            {initials(user.name)}
          </span>
          <div>
            <h1>{user.name}</h1>
            <p>
              <span className="mono">{user.username}</span> · <span className="cap">{user.role}</span>
            </p>
          </div>
        </div>
      </div>
      <section className="card narrow">
        <div className="cardhead">
          <h2>Change password</h2>
        </div>
        {error && <div className="error">{error}</div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (next !== confirm) return setError("New passwords do not match");
            try {
              await api("/me/password", { method: "POST", json: { current, next } });
              toast("Password changed");
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
    </div>
  );
}
