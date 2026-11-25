import { useEffect, useRef } from "react";

/**
 * Ambient background: soft colour fields + thin outline shapes that drift with
 * scroll (parallax) and lean towards the cursor with a spring-like lag, plus a
 * dot grid revealed in a soft spotlight around the pointer.
 *
 * Performance: one rAF loop that sleeps once everything has settled; only
 * `transform` / `opacity` / a mask position on a single element are written.
 */
type Layer = {
  depth: number; // cursor parallax strength (px at the screen edge)
  scroll: number; // scroll parallax factor (px moved per px scrolled)
  spin?: number; // degrees rotated per 1000px scrolled
  base?: number; // base rotation
};

const BLOBS: (Layer & { cls: string })[] = [
  { cls: "blob b1", depth: 40, scroll: 0.18 },
  { cls: "blob b2", depth: -50, scroll: 0.3 },
  { cls: "blob b3", depth: 30, scroll: 0.1 },
  { cls: "blob b4", depth: -26, scroll: 0.4 },
  { cls: "blob b5", depth: 18, scroll: 0.22 },
];
const SHAPES: (Layer & { cls: string; text?: string })[] = [
  { cls: "half h1", depth: 64, scroll: 0.45, spin: 10, base: -8 },
  { cls: "half h2", depth: -48, scroll: 0.6, spin: -26, base: 14 },
  { cls: "half h3", depth: 70, scroll: 0.75, spin: 40, base: 180 },
  { cls: "bar m1", depth: -36, scroll: 0.52, spin: 18, base: -14 },
  { cls: "bar m2", depth: 52, scroll: 0.66, spin: -20, base: 22 },
  { cls: "ring r1", depth: 34, scroll: 0.28, spin: 12 },
  { cls: "ring r2", depth: -40, scroll: 0.36, spin: -8 },
  { cls: "dot d1", depth: 90, scroll: 0.8 },
  { cls: "dot d2", depth: -80, scroll: 0.58 },
  { cls: "dot d3", depth: 60, scroll: 0.7 },
];
// watermark is capped like the blobs (index handled below)
const WATERMARK = { cls: "watermark", depth: -14, scroll: 0.12, text: "½M" };
const LAYERS: (Layer & { cls: string; text?: string })[] = [...BLOBS, WATERMARK, ...SHAPES];
const CAPPED = BLOBS.length + 1; // blobs + watermark ease to a stop

export default function Backdrop() {
  const root = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const nodes = [...el.querySelectorAll<HTMLElement>("[data-layer]")];
    // layout of each layer (fixed container → viewport coordinates)
    let meta = nodes.map((n) => ({ top: n.offsetTop, h: n.offsetHeight }));
    let vh = window.innerHeight;
    const measure = () => {
      vh = window.innerHeight;
      meta = nodes.map((n) => ({ top: n.offsetTop, h: n.offsetHeight }));
      kick();
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

    // target and current values
    const target = { mx: 0, my: 0, sy: window.scrollY, px: -999, py: -999, glow: 0 };
    const cur = { ...target };
    let raf = 0;
    // adaptive quality: if this device can't keep ~30fps while the backdrop moves,
    // freeze the backdrop (static, still pretty) so the rest of the UI stays smooth
    let lite = false;
    let last = 0;
    const samples: number[] = [];

    const render = (now: number) => {
      raf = 0;
      if (reduce.matches || lite) return;
      if (last && now - last < 200) {
        samples.push(now - last);
        if (samples.length >= 45) {
          const sorted = [...samples].sort((a, b) => a - b);
          if (sorted[sorted.length >> 1] > 34) {
            lite = true;
            el.dataset.lite = "1";
            return;
          }
          samples.length = 0;
        }
      }
      last = now;
      // spring-ish lerp: cursor eases slowly, scroll follows quickly
      const k = 0.075, ks = 0.22, kp = 0.18;
      cur.mx += (target.mx - cur.mx) * k;
      cur.my += (target.my - cur.my) * k;
      cur.sy += (target.sy - cur.sy) * ks;
      cur.px += (target.px - cur.px) * kp;
      cur.py += (target.py - cur.py) * kp;
      cur.glow += (target.glow - cur.glow) * 0.12;

      for (let i = 0; i < nodes.length; i++) {
        const L = LAYERS[i];
        const x = cur.mx * L.depth;
        let sy = cur.sy * L.scroll;
        if (i < CAPPED) {
          // colour fields ease to a stop so they never leave the screen
          const A = vh * 0.35;
          sy = A * Math.tanh(sy / A);
        } else {
          // small shapes loop: wrap around once fully off-screen (invisible jump)
          const { top, h } = meta[i];
          const span = vh + h * 2;
          const pos = top - sy;
          const wrapped = ((((pos + h) % span) + span) % span) - h;
          sy = top - wrapped;
        }
        const y = cur.my * L.depth - sy;
        const r = (L.base ?? 0) + (L.spin ? (cur.sy / 1000) * L.spin + cur.mx * 4 : 0);
        nodes[i].style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg)`;
      }
      if (grid.current) {
        grid.current.style.setProperty("--gx", `${cur.px.toFixed(0)}px`);
        grid.current.style.setProperty("--gy", `${cur.py.toFixed(0)}px`);
        grid.current.style.opacity = cur.glow.toFixed(3);
        // grid drifts slightly with scroll so it feels attached to the page
        grid.current.style.backgroundPosition = `0 ${(-cur.sy * 0.15).toFixed(1)}px`;
      }

      const moving =
        Math.abs(target.mx - cur.mx) > 0.0005 ||
        Math.abs(target.my - cur.my) > 0.0005 ||
        Math.abs(target.sy - cur.sy) > 0.3 ||
        Math.abs(target.px - cur.px) > 0.5 ||
        Math.abs(target.glow - cur.glow) > 0.003;
      if (moving && !document.hidden) raf = requestAnimationFrame(render);
      else last = 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(render);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      target.mx = (e.clientX / window.innerWidth) * 2 - 1;
      target.my = (e.clientY / window.innerHeight) * 2 - 1;
      target.px = e.clientX;
      target.py = e.clientY;
      if (cur.px < -900) {
        cur.px = target.px;
        cur.py = target.py;
      }
      target.glow = 1;
      kick();
    };
    const onLeave = () => {
      target.glow = 0;
      target.mx = 0;
      target.my = 0;
      kick();
    };
    const onScroll = () => {
      target.sy = window.scrollY;
      kick();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    if (finePointer.matches) {
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);
    }
    document.addEventListener("visibilitychange", kick);
    kick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);

  return (
    <div className="backdrop" ref={root} aria-hidden="true">
      {LAYERS.map((l, i) => (
        <div key={i} className={l.cls} data-layer style={{ transform: `rotate(${l.base ?? 0}deg)` }}>
          {l.text}
        </div>
      ))}
      <div className="dotgrid" ref={grid} />
      <div className="grain" />
    </div>
  );
}
