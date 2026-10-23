import { useEffect, useRef } from 'react';
import type { MatchEvent, MatchMeta, PlayerStats } from '@matchlight/schema';
import { store } from '../lib/store';

/** Pitch rectangle inside the 16:9 broadcast stage (fractions of stage size). */
export const PITCH_BOX = { x: 0.135, y: 0.085, w: 0.73, h: 0.83 };

export function pitchToStage(x: number, y: number): { left: number; top: number } {
  // y = 0 is drawn at the bottom so "left touchline" (y = 68 for home) is at the top of the screen.
  return { left: PITCH_BOX.x + (x / 105) * PITCH_BOX.w, top: PITCH_BOX.y + (1 - y / 68) * PITCH_BOX.h };
}

/** Smoothed on-screen positions, shared with the overlay layer so player tags track players. */
export const livePositions = new Map<string, { x: number; y: number }>();

interface Props {
  focusPlayerId?: string;
  heat?: PlayerStats | null;
  highContrast?: boolean;
  dim?: boolean;
}

export function Pitch({ focusPlayerId, heat, highContrast, dim }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const props = useRef({ focusPlayerId, heat, highContrast, dim });
  props.current = { focusPlayerId, heat, highContrast, dim };

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    const ball = { x: 52.5, y: 34, z: 0 };
    const trail: { x: number; y: number }[] = [];
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(10, r.width * dpr);
      canvas.height = Math.max(10, r.height * dpr);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const W = canvas.width;
      const H = canvas.height;
      const P = { x: PITCH_BOX.x * W, y: PITCH_BOX.y * H, w: PITCH_BOX.w * W, h: PITCH_BOX.h * H };
      const sx = (x: number) => P.x + (x / 105) * P.w;
      const sy = (y: number) => P.y + (1 - y / 68) * P.h;
      const m = P.w / 105;
      const { focusPlayerId: focus, heat: heatStats, highContrast: hc, dim: isDim } = props.current;
      const meta = store.meta;

      // Atmosphere: night sky + floodlight pools.
      ctx.fillStyle = hc ? '#000' : '#05080a';
      ctx.fillRect(0, 0, W, H);
      if (!hc) {
        for (const [fx, fy] of [
          [0.05, 0],
          [0.95, 0],
          [0.05, 1],
          [0.95, 1],
        ]) {
          const g = ctx.createRadialGradient(fx * W, fy * H, 0, fx * W, fy * H, W * 0.55);
          g.addColorStop(0, 'rgba(200,255,46,0.07)');
          g.addColorStop(1, 'rgba(200,255,46,0)');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
      }
      // Grass with mowing stripes.
      const stripes = 14;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = hc ? (i % 2 ? '#0b2a14' : '#0d3018') : i % 2 ? '#0f3b22' : '#124528';
        ctx.fillRect(P.x + (i * P.w) / stripes, P.y, P.w / stripes + 1, P.h);
      }
      const vg = ctx.createRadialGradient(W / 2, H / 2, P.h * 0.2, W / 2, H / 2, P.w * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vg;
      ctx.fillRect(P.x, P.y, P.w, P.h);

      // Heatmap (player focus).
      if (heatStats) {
        const max = Math.max(1, ...heatStats.heat);
        heatStats.heat.forEach((v, i) => {
          if (!v) return;
          const gx = i % 12;
          const gy = Math.floor(i / 12);
          // heat is in the player's attacking coords; mirror for the away side.
          let x0 = gx * (105 / 12);
          let y0 = gy * (68 / 8);
          if (heatStats.side === 'away') {
            x0 = 105 - x0 - 105 / 12;
            y0 = 68 - y0 - 68 / 8;
          }
          ctx.fillStyle = `rgba(200,255,46,${0.08 + 0.5 * (v / max)})`;
          ctx.fillRect(sx(x0) + 1, sy(y0 + 68 / 8) + 1, (105 / 12) * m - 2, (68 / 8) * m - 2);
        });
      }

      // Chalk lines.
      ctx.strokeStyle = hc ? '#fff' : 'rgba(236,244,230,0.78)';
      ctx.lineWidth = Math.max(1, m * 0.14);
      const line = (pts: [number, number][]) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
        ctx.stroke();
      };
      ctx.strokeRect(P.x, P.y, P.w, P.h);
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
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.arc(sx(x0 + d * 11), sy(34), m * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(sx(side ? 105 : -1.6), sy(37.66), 1.6 * m, 7.32 * m);
      }

      // Players: exponential smoothing toward the latest tracking frame.
      const frame = store.frame;
      const k = 1 - Math.exp(-dt * 7);
      if (frame) {
        const seen = new Set<string>();
        for (const p of frame.players) {
          seen.add(p.id);
          const cur = livePositions.get(p.id);
          if (!cur) livePositions.set(p.id, { x: p.x, y: p.y });
          else {
            cur.x += (p.x - cur.x) * k;
            cur.y += (p.y - cur.y) * k;
          }
        }
        for (const id of [...livePositions.keys()]) if (!seen.has(id)) livePositions.delete(id);
        ball.x += (frame.ball.x - ball.x) * Math.min(1, k * 1.6);
        ball.y += (frame.ball.y - ball.y) * Math.min(1, k * 1.6);
        ball.z += (frame.ball.z - ball.z) * k;
      }
      const recent = recentActors();
      if (meta && frame) {
        for (const p of frame.players) {
          const pos = livePositions.get(p.id)!;
          const team = p.side === 'home' ? meta.home : meta.away;
          const player = team.players.find((pl) => pl.id === p.id);
          const x = sx(pos.x);
          const y = sy(pos.y);
          const r = Math.max(5, m * 1.15);
          const isFocus = p.id === focus;
          if (recent.has(p.id)) {
            ctx.beginPath();
            ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(200,255,46,0.18)';
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(x, y + r * 0.35, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = team.colors.primary;
          ctx.globalAlpha = isDim && !isFocus ? 0.45 : 1;
          ctx.fill();
          ctx.lineWidth = Math.max(1.5, r * 0.22);
          ctx.strokeStyle = isFocus ? '#c8ff2e' : team.colors.secondary;
          ctx.stroke();
          ctx.globalAlpha = 1;
          if (isFocus) {
            const pulse = 1.6 + 0.4 * Math.sin(now / 220);
            ctx.beginPath();
            ctx.arc(x, y, r * pulse, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(200,255,46,0.8)';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
          if (player && r > 7) {
            ctx.fillStyle = contrast(team.colors.primary);
            ctx.font = `700 ${Math.round(r * 0.95)}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(player.number), x, y + 0.5);
          }
        }
        // Ball + trail.
        trail.push({ x: ball.x, y: ball.y });
        if (trail.length > 16) trail.shift();
        trail.forEach((t, i) => {
          ctx.beginPath();
          ctx.arc(sx(t.x), sy(t.y), m * 0.35 * (i / trail.length), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${0.25 * (i / trail.length)})`;
          ctx.fill();
        });
        const lift = ball.z * m * 0.5;
        ctx.beginPath();
        ctx.ellipse(sx(ball.x), sy(ball.y) + m * 0.3, m * 0.55, m * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fill();
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sx(ball.x), sy(ball.y) - lift, m * (0.55 + ball.z * 0.03), 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="pitch-canvas"
      role="img"
      aria-label="Live 2D pitch with synthetic player tracking"
    />
  );
}

function recentActors(): Set<string> {
  const now = store.now();
  const out = new Set<string>();
  const evs: MatchEvent[] = store.events;
  for (let i = evs.length - 1; i >= 0 && i > evs.length - 12; i--) {
    const e = evs[i];
    if (now - e.ts > 2.5) break;
    if (e.player_id) out.add(e.player_id);
  }
  return out;
}

function contrast(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#0a0d10' : '#fff';
}

export type { MatchMeta };
