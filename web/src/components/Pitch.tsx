import { useEffect, useRef } from 'react';
import type { MatchEvent, Side, TrackedMetric, ViewerMode } from '@matchlight/schema';
import { kit, type Kit } from '../lib/kits';
import { store } from '../lib/store';

/** Maps pitch metres to fractions of the canvas box. Updated every frame (the player channel crops and follows). */
export interface PitchView {
  toStage(x: number, y: number): { left: number; top: number; visible: boolean };
}

export function createView(): PitchView & {
  set(f: (x: number, y: number) => { left: number; top: number; visible: boolean }): void;
} {
  let fn = (x: number, y: number) => ({
    left: 0.04 + (x / 105) * 0.92,
    top: 0.06 + (1 - y / 68) * 0.88,
    visible: true,
  });
  return {
    toStage: (x, y) => fn(x, y),
    set: (f) => (fn = f),
  };
}

/** Smoothed positions per player, shared across pitches. */
const live = new Map<string, { x: number; y: number }>();

/** The kickoff sequence plays once per page load. */
let bootAt = 0;
const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Props {
  mode: ViewerMode;
  focusPlayerId?: string;
  favorite?: Side;
  metric?: TrackedMetric;
  highContrast?: boolean;
  view: ReturnType<typeof createView>;
  label: string;
}

const C = {
  stand: '#18211F',
  pitch: '#1F4430',
  pitch2: '#22492F',
  chalk: '#ECEBE2',
  bib: '#F2862E',
  marker: '#7FB2FF',
  flood: '#FFE7AE',
};

export function Pitch(props: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const p = useRef(props);
  p.current = props;

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    if (!bootAt) bootAt = performance.now();
    let raf = 0;
    let last = performance.now();
    const ball = { x: 52.5, y: 34 };
    const cam = { x: 52.5, y: 34, z: 1 };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(10, Math.round(r.width * dpr));
      canvas.height = Math.max(10, Math.round(r.height * dpr));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { mode, focusPlayerId, favorite, metric, highContrast: hc, view } = p.current;
      const W = canvas.width;
      const H = canvas.height;
      const meta = store.meta;
      const state = store.state;
      const frame = store.frame;
      const boot = reducedMotion() ? 10 : (now - bootAt) / 1000;
      const ease = (a: number, b: number) => Math.max(0, Math.min(1, (boot - a) / (b - a)));

      // Fit 105 x 68 into the canvas with a margin, then apply the camera (player channel crops in).
      const margin = 0.04;
      const fit = Math.min((W * (1 - 2 * margin)) / 105, (H * (1 - 2 * margin * 1.4)) / 68);
      const focus = focusPlayerId ? live.get(focusPlayerId) : undefined;
      const wantZ = mode === 'player' && focus ? 1.8 : 1;
      const k = 1 - Math.exp(-dt * 3);
      cam.z += (wantZ - cam.z) * k;
      const tx = mode === 'player' && focus ? focus.x : 52.5;
      const ty = mode === 'player' && focus ? focus.y : 34;
      cam.x += (tx - cam.x) * k;
      cam.y += (ty - cam.y) * k;
      // Keep the crop inside the pitch.
      const halfW = W / (2 * fit * cam.z);
      const halfH = H / (2 * fit * cam.z);
      const cx = cam.z > 1.01 ? Math.min(105 + 4 - halfW, Math.max(-4 + halfW, cam.x)) : 52.5;
      const cy = cam.z > 1.01 ? Math.min(68 + 4 - halfH, Math.max(-4 + halfH, cam.y)) : 34;
      const m = fit * cam.z;
      const sx = (x: number) => W / 2 + (x - cx) * m;
      const sy = (y: number) => H / 2 - (y - cy) * m;
      view.set((x, y) => {
        const l = sx(x) / W;
        const t = sy(y) / H;
        return { left: l, top: t, visible: l > 0.02 && l < 0.98 && t > 0.02 && t < 0.98 };
      });

      // Numbers and units on the board always read left to right, whatever the page direction.
      ctx.direction = 'ltr';
      ctx.fillStyle = hc ? '#000' : C.stand;
      ctx.fillRect(0, 0, W, H);

      // Grass, mown in stripes.
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = hc ? (i % 2 ? '#0F2A1A' : '#11301D') : i % 2 ? C.pitch : C.pitch2;
        ctx.fillRect(sx((i * 105) / 12), sy(68), (105 / 12) * m + 1, 68 * m);
      }

      const homeKit = kit(meta, 'home');
      const awayKit = kit(meta, 'away');

      // Territory: a momentum front across the pitch, each side shaded in its kit.
      if (state && mode !== 'player') {
        const front = 52.5 + Math.max(-100, Math.min(100, state.momentum)) * 0.32;
        const a = (mode === 'metric' ? 0.1 : 0.2) * ease(0.9, 1.7);
        const wob = (yy: number) => front + Math.sin(yy / 6 + now / 2400) * 0.8;
        const shade = (side: Side, color: string) => {
          if (mode === 'club' && favorite && side !== favorite) return;
          ctx.beginPath();
          const edge = side === 'home' ? 0 : 105;
          ctx.moveTo(sx(edge), sy(0));
          for (let yy = 0; yy <= 68; yy += 4) ctx.lineTo(sx(wob(yy)), sy(yy));
          ctx.lineTo(sx(edge), sy(68));
          ctx.closePath();
          ctx.fillStyle = hexA(color, a);
          ctx.fill();
        };
        shade('home', homeKit.base);
        shade('away', awayKit.base);
        // The front itself, drawn like a marker on the board.
        ctx.beginPath();
        for (let yy = 0; yy <= 68; yy += 2) (yy ? ctx.lineTo : ctx.moveTo).call(ctx, sx(wob(yy)), sy(yy));
        ctx.strokeStyle = hexA(C.chalk, 0.35 * ease(0.9, 1.7));
        ctx.setLineDash([m * 1.2, m * 1.4]);
        ctx.lineWidth = Math.max(1, m * 0.22);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Chalk markings, painted outward from the halfway line during kickoff.
      const paint = ease(0.1, 1.3);
      ctx.save();
      const reach = paint * 60;
      ctx.beginPath();
      ctx.rect(sx(52.5 - reach), 0, reach * 2 * m, H);
      ctx.clip();
      ctx.strokeStyle = hc ? '#FFFFFF' : hexA(C.chalk, 0.82);
      ctx.lineWidth = Math.max(1, m * (hc ? 0.22 : 0.13));
      const line = (pts: [number, number][]) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      };
      line([
        [0, 0],
        [105, 0],
        [105, 68],
        [0, 68],
        [0, 0],
      ]);
      line([
        [52.5, 0],
        [52.5, 68],
      ]);
      ctx.beginPath();
      ctx.arc(sx(52.5), sy(34), 9.15 * m, 0, Math.PI * 2);
      ctx.stroke();
      for (const side of [0, 1]) {
        const x0 = side ? 105 : 0;
        const d = side ? -1 : 1;
        line([
          [x0, 13.84],
          [x0 + d * 16.5, 13.84],
          [x0 + d * 16.5, 54.16],
          [x0, 54.16],
        ]);
        line([
          [x0, 24.84],
          [x0 + d * 5.5, 24.84],
          [x0 + d * 5.5, 43.16],
          [x0, 43.16],
        ]);
        ctx.beginPath();
        ctx.arc(
          sx(x0 + d * 11),
          sy(34),
          9.15 * m,
          side ? Math.PI * 0.705 : -Math.PI * 0.295,
          side ? Math.PI * 1.295 : Math.PI * 0.295,
        );
        ctx.stroke();
        line([
          [x0, 30.34],
          [x0 - d * 1.5, 30.34],
          [x0 - d * 1.5, 37.66],
          [x0, 37.66],
        ]);
      }
      ctx.restore();

      // Analyst annotations: pressing lines, recent passes as marker strokes, shots as crosses.
      const recent = store.events;
      const nowTs = store.now();
      if (state && frame && (mode === 'analyst' || (mode === 'metric' && metric === 'ppda'))) {
        for (const side of ['home', 'away'] as const) {
          const own = frame.players.filter((pl) => pl.side === side);
          if (own.length < 4) continue;
          const xs = own.map((pl) => pl.x).sort((a, b) => (side === 'home' ? a - b : b - a));
          // The back line: average of the four deepest outfield players (xs[0] is the keeper).
          const back = xs.slice(1, 5);
          const lineX = back.reduce((acc, v) => acc + v, 0) / back.length;
          const ppda = state.teams[side].ppda_10 ?? 12;
          const intensity = Math.max(0, Math.min(1, (16 - ppda) / 12));
          const kt = side === 'home' ? homeKit : awayKit;
          ctx.strokeStyle = hexA(kt.trim, 0.85 * ease(1.5, 2.1));
          ctx.lineWidth = Math.max(1.5, m * (0.15 + intensity * 0.7));
          ctx.lineCap = 'round';
          markerLine(ctx, sx(lineX), sy(3), sx(lineX), sy(65), hash(side) % 97);
          ctx.fillStyle = C.marker;
          ctx.font = `600 ${Math.max(10, m * 1.35)}px "IBM Plex Sans", sans-serif`;
          ctx.textAlign = 'center';
          const metres = Math.round(side === 'home' ? lineX : 105 - lineX);
          ctx.fillText(
            `${metres} m`,
            sx(lineX),
            sy(side === 'home' ? 66 : 2) + (side === 'home' ? -4 : m * 1.4),
          );
        }
      }
      if (mode === 'analyst' || mode === 'metric') {
        const passes = recent.filter(
          (e): e is Extract<MatchEvent, { type: 'pass' }> =>
            e.type === 'pass' && e.outcome === 'complete' && nowTs - e.ts < 150 && e.length_m > 16,
        );
        const shown =
          mode === 'metric' ? (metric === 'ball_speed' ? passes.slice(-1) : []) : passes.slice(-6);
        shown.forEach((e, i) => {
          const age = (nowTs - e.ts) / 150;
          const box = (e.team === 'home' ? e.end_x > 88.5 : e.end_x < 16.5) && Math.abs(e.end_y - 34) < 20;
          ctx.strokeStyle = hexA(
            box || mode === 'metric' ? C.bib : C.marker,
            (mode === 'metric' ? 1 : 0.9 - age * 0.6) * ease(1.6, 2.2),
          );
          ctx.lineWidth = Math.max(1.5, m * (mode === 'metric' ? 0.45 : 0.28));
          markerArrow(ctx, sx(e.x ?? 0), sy(e.y ?? 0), sx(e.end_x), sy(e.end_y), hash(e.id) + i, m);
          if (mode === 'metric') {
            ctx.fillStyle = C.bib;
            ctx.font = `600 ${Math.max(12, m * 2)}px "IBM Plex Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText(
              `${Math.round(e.ball_speed_kmh)} km/h`,
              sx((e.x! + e.end_x) / 2),
              sy((e.y! + e.end_y) / 2) - m * 1.2,
            );
          }
        });
        if (mode === 'analyst') {
          for (const s of recent.filter((e) => e.type === 'shot' && nowTs - e.ts < 300).slice(-5)) {
            const x = sx(s.x ?? 0);
            const y = sy(s.y ?? 0);
            const r = m * 0.9;
            ctx.strokeStyle = C.bib;
            ctx.lineWidth = Math.max(1.5, m * 0.25);
            ctx.beginPath();
            ctx.moveTo(x - r, y - r);
            ctx.lineTo(x + r, y + r);
            ctx.moveTo(x + r, y - r);
            ctx.lineTo(x - r, y + r);
            ctx.stroke();
            if (s.type === 'shot' && s.outcome === 'goal') {
              ctx.beginPath();
              ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }

      // Player channel: a chalk trail of the player's last touches.
      if (mode === 'player' && focusPlayerId) {
        const touches = recent
          .filter((e) => e.player_id === focusPlayerId && e.x !== undefined && e.y !== undefined)
          .slice(-14);
        if (touches.length > 1) {
          ctx.strokeStyle = hexA(C.chalk, 0.75);
          ctx.lineWidth = Math.max(1.5, m * 0.12);
          ctx.setLineDash([m * 0.6, m * 0.5]);
          ctx.beginPath();
          touches.forEach((e, i) => (i ? ctx.lineTo(sx(e.x!), sy(e.y!)) : ctx.moveTo(sx(e.x!), sy(e.y!))));
          ctx.stroke();
          ctx.setLineDash([]);
          touches.forEach((e, i) => {
            ctx.beginPath();
            ctx.arc(sx(e.x!), sy(e.y!), m * (0.25 + (0.25 * i) / touches.length), 0, Math.PI * 2);
            ctx.fillStyle = hexA(C.chalk, 0.35 + (0.6 * i) / touches.length);
            ctx.fill();
          });
        }
      }

      // Players as kit swatches.
      if (frame && meta) {
        const kk = 1 - Math.exp(-dt * 7);
        const seen = new Set<string>();
        for (const pl of frame.players) {
          seen.add(pl.id);
          const cur = live.get(pl.id);
          if (!cur) live.set(pl.id, { x: pl.x, y: pl.y });
          else {
            cur.x += (pl.x - cur.x) * kk;
            cur.y += (pl.y - cur.y) * kk;
          }
        }
        for (const id of [...live.keys()]) if (!seen.has(id)) live.delete(id);
        ball.x += (frame.ball.x - ball.x) * Math.min(1, kk * 1.6);
        ball.y += (frame.ball.y - ball.y) * Math.min(1, kk * 1.6);
        const actors = new Set(
          recent
            .slice(-4)
            .filter((e) => nowTs - e.ts < 2.5)
            .map((e) => e.player_id),
        );
        frame.players.forEach((pl, i) => {
          const appear = ease(1.2 + (i % 11) * 0.04, 1.6 + (i % 11) * 0.04);
          if (appear <= 0) return;
          const pos = live.get(pl.id)!;
          const kt = pl.side === 'home' ? homeKit : awayKit;
          const size = Math.max(7, m * 1.7) * (0.6 + 0.4 * appear);
          const isFocus = pl.id === focusPlayerId;
          const dim = (mode === 'player' && !isFocus) || mode === 'metric';
          ctx.globalAlpha = appear * (dim ? 0.55 : 1);
          if (actors.has(pl.id) && !dim) {
            ctx.beginPath();
            ctx.arc(sx(pos.x), sy(pos.y), size * 1.2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,231,174,0.22)';
            ctx.fill();
          }
          swatch(ctx, sx(pos.x), sy(pos.y), size, kt);
          if (isFocus) {
            ctx.strokeStyle = C.bib;
            ctx.lineWidth = Math.max(2, m * 0.3);
            ctx.beginPath();
            ctx.arc(sx(pos.x), sy(pos.y), size * 1.15, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (mode === 'analyst' && size > 12) {
            const n = (pl.side === 'home' ? meta.home : meta.away).players.find(
              (x) => x.id === pl.id,
            )?.number;
            if (n !== undefined) {
              ctx.fillStyle = C.chalk;
              ctx.font = `600 ${Math.round(size * 0.55)}px "IBM Plex Sans", sans-serif`;
              ctx.textAlign = 'center';
              ctx.fillText(String(n), sx(pos.x), sy(pos.y) + size * 0.95);
            }
          }
          ctx.globalAlpha = 1;
        });
        // Ball.
        ctx.beginPath();
        ctx.arc(sx(ball.x), sy(ball.y), Math.max(3, m * 0.55), 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="pitch-canvas" role="img" aria-label={props.label} />;
}

/** A kit swatch: rounded fabric square with the club's pattern. */
function swatch(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, k: Kit) {
  const h = s / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x - h, y - h, s, s, s * 0.22);
  ctx.fillStyle = k.base;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = k.trim;
  switch (k.pattern) {
    case 'hoops':
      for (let i = 0; i < 3; i++) ctx.fillRect(x - h, y - h + (s / 5) * (i * 2 + 0.5), s, s / 5);
      break;
    case 'halves':
      ctx.fillRect(x, y - h, h, s);
      break;
    case 'sash':
      ctx.beginPath();
      ctx.moveTo(x - h, y - h + s * 0.15);
      ctx.lineTo(x - h + s * 0.15, y - h);
      ctx.lineTo(x + h, y + h - s * 0.15);
      ctx.lineTo(x + h - s * 0.15, y + h);
      ctx.closePath();
      ctx.fill();
      break;
    case 'pinstripe':
      for (let i = 1; i < 5; i++) ctx.fillRect(x - h + (s / 5) * i, y - h, Math.max(1, s * 0.06), s);
      break;
    case 'band':
      ctx.fillRect(x - h, y - s * 0.12, s, s * 0.24);
      break;
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - h, y - h, s, s, s * 0.22);
  ctx.stroke();
}

/** A slightly wobbly straight stroke, like a marker pen on a board. */
function markerLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
) {
  const mx = (x1 + x2) / 2 + Math.sin(seed) * 3;
  const my = (y1 + y2) / 2;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(mx, my, x2, y2);
  ctx.stroke();
}

/** A curved marker arrow with a hand-drawn head. */
function markerArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  m: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const bend = ((seed % 7) - 3) * 0.04 * len;
  const cx = (x1 + x2) / 2 - (dy / len) * bend;
  const cy = (y1 + y2) / 2 + (dx / len) * bend;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
  const ang = Math.atan2(y2 - cy, x2 - cx);
  const hl = Math.max(6, m * 1.4);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - hl * Math.cos(ang + 0.5), y2 - hl * Math.sin(ang + 0.5));
  ctx.stroke();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
