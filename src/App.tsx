import { useEffect, useState } from "react";
import { api, type User } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import BranchDetail from "./pages/BranchDetail";
import Approvals from "./pages/Approvals";
import Uploads from "./pages/Uploads";
import Users from "./pages/Users";
import Actions from "./pages/Actions";
import Account from "./pages/Account";

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const route = useHashRoute();

  useEffect(() => {
    api<{ user: User }>("/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const onUnauth = () => setUser(null);
    window.addEventListener("hm:unauthorized", onUnauth);
    return () => window.removeEventListener("hm:unauthorized", onUnauth);
  }, []);

  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={setUser} />;

  const isAdmin = user.role === "admin";
  const nav = [
    { href: "/", label: "Dashboard" },
    { href: "/actions", label: "Actions" },
    { href: "/approvals", label: isAdmin ? "Optimum approvals" : "Optimum requests" },
    { href: "/uploads", label: "Headcount" },
    ...(isAdmin ? [{ href: "/users", label: "Users" }] : []),
  ];
  const active = (href: string) => (href === "/" ? route === "/" || route.startsWith("/branch/") : route.startsWith(href));

  let page;
  if (route.startsWith("/branch/")) page = <BranchDetail code={decodeURIComponent(route.slice(8))} user={user} />;
  else if (route.startsWith("/actions")) page = <Actions user={user} />;
  else if (route.startsWith("/approvals")) page = <Approvals user={user} />;
  else if (route.startsWith("/uploads")) page = <Uploads user={user} />;
  else if (route.startsWith("/users") && isAdmin) page = <Users user={user} />;
  else if (route.startsWith("/account")) page = <Account user={user} />;
  else page = <Dashboard user={user} />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="logo">HM</span>
          <span>Labor Optimization</span>
        </div>
        <nav>
          {nav.map((n) => (
            <a key={n.href} href={`#${n.href}`} className={active(n.href) ? "on" : ""}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="who">
          <a href="#/account" title="Account">
            {user.name} <span className="pill">{user.role}</span>
          </a>
          <button
            className="ghost"
            onClick={async () => {
              await api("/logout", { method: "POST" }).catch(() => {});
              setUser(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <main>{page}</main>
    </div>
  );
}
