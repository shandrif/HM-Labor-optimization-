import { useState } from "react";
import { api, type User } from "../api";

export default function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="center">
      <form
        className="card login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await api<{ user: User }>("/login", { method: "POST", json: { username, password } });
            onLogin(r.user);
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="brand big">
          <span className="logo">HM</span>
          <span>Labor Optimization</span>
        </div>
        <label>
          Username
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
