import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, clearApiCache, type User } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import BranchDetail from "./pages/BranchDetail";
import Approvals from "./pages/Approvals";
import Uploads from "./pages/Uploads";
import Users from "./pages/Users";
import Actions from "./pages/Actions";
import Account from "./pages/Account";
import { DialogHost, Icon, initials, Toaster } from "./ui";
import Backdrop from "./Backdrop";

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash.slice(1) || "/");
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

/** Adds `.in` to `.reveal` sections once they scroll into view (one-shot). */
function useReveal(route: string) {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    document.documentElement.classList.add("js-reveal");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    const scan = () => document.querySelectorAll(".reveal:not(.in)").forEach((el) => io.observe(el));
    scan();
    const mo = new MutationObserver(scan);
    const main = document.querySelector("main");
    if (main) mo.observe(main, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [route]);
}

function useScrolled() {
  const [s, setS] = useState(false);
  useEffect(() => {
    const on = () => setS(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return s;
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

  if (user === undefined) return <Backdrop />;
  if (!user)
    return (
      <>
        <Backdrop />
        <Login onLogin={setUser} />
        <Toaster />
      </>
    );
  return (
    <>
      <Backdrop />
      <Shell user={user} route={route} onSignOut={() => setUser(null)} />
    </>
  );
}

function Shell({ user, route, onSignOut }: { user: User; route: string; onSignOut: () => void }) {
  const isAdmin = user.role === "admin";
  const scrolled = useScrolled();
  useReveal(route);
  const [pending, setPending] = useState({ actions: 0, optimum: 0 });

  useEffect(() => {
    if (!isAdmin) return;
    api("/pending")
      .then((r) => setPending({ actions: r.actions, optimum: r.optimum }))
      .catch(() => {});
  }, [route, isAdmin]);

  const nav = [
    { href: "/", label: "Dashboard", icon: "dashboard" },
    { href: "/actions", label: "Actions", icon: "actions", count: pending.actions },
    { href: "/approvals", label: isAdmin ? "Approvals" : "Requests", icon: "approvals", count: pending.optimum },
    { href: "/uploads", label: "Headcount", icon: "upload" },
    ...(isAdmin ? [{ href: "/users", label: "Users", icon: "users" }] : []),
  ];
  const isActive = (href: string) => (href === "/" ? route === "/" || route.startsWith("/branch/") : route.startsWith(href));

  let page;
  if (route.startsWith("/branch/")) page = <BranchDetail code={decodeURIComponent(route.slice(8))} user={user} />;
  else if (route.startsWith("/actions")) page = <Actions user={user} />;
  else if (route.startsWith("/approvals")) page = <Approvals user={user} />;
  else if (route.startsWith("/uploads")) page = <Uploads user={user} />;
  else if (route.startsWith("/users") && isAdmin) page = <Users user={user} />;
  else if (route.startsWith("/account")) page = <Account user={user} />;
  else page = <Dashboard user={user} />;

  return (
    <div className={`shell ${scrolled ? "scrolled" : ""}`}>
      <header className="topbar">
        <div className="topbar-inner">
          <a href="#/" className="brand" aria-label="Dashboard">
            <span className="logo">½M</span>
            <span className="brand-text">Labor Optimization</span>
          </a>
          <Nav items={nav} isActive={isActive} />
          <div className="who">
            <a href="#/account" className="userchip" title="Account">
              <span className="avatar">{initials(user.name)}</span>
              <span className="meta">
                <span>{user.name}</span>
                <span>{user.role}</span>
              </span>
            </a>
            <button
              className="quiet icon-btn signout"
              title="Sign out"
              aria-label="Sign out"
              onClick={async () => {
                await api("/logout", { method: "POST" }).catch(() => {});
                clearApiCache();
                onSignOut();
              }}
            >
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </header>
      <main key={route.startsWith("/branch/") ? route : route.split("/")[1]}>{page}</main>
      <Toaster />
      <DialogHost />
    </div>
  );
}

function Nav({
  items,
  isActive,
}: {
  items: { href: string; label: string; icon: string; count?: number }[];
  isActive: (h: string) => boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  const activeHref = items.find((i) => isActive(i.href))?.href;

  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLAnchorElement>("a.on");
      if (!el) return setInd(null);
      setInd({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [activeHref, items.length, items.map((i) => i.count).join()]);

  return (
    <nav className="nav" ref={ref}>
      {ind && <span className="nav-indicator" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} />}
      {items.map((n) => (
        <a key={n.href} href={`#${n.href}`} className={isActive(n.href) ? "on" : ""} title={n.label}>
          <Icon name={n.icon} />
          <span className="label">{n.label}</span>
          {!!n.count && <span className="count">{n.count}</span>}
        </a>
      ))}
    </nav>
  );
}
