// The weather over the 2D map: drifting clouds, fog, rain or snow, and soft lightning.
// It sits between the rooms and the people, so names and statuses always stay on top.
import { useEffect, useRef, type CSSProperties } from 'react';
import styled, { keyframes } from 'styled-components';
import { mixColor, type Ambience } from '../lib/ambience.ts';
import { media } from '../styles/theme.ts';

const FRAME_MS = 1000 / 30;
/** Most drops or flakes on a large map; smaller maps and lighter weather show fewer. */
const MAX_PARTICLES = { rain: 340, drizzle: 260, snow: 220 } as const;
/** A map of this many square pixels shows all of them. */
const FULL_AREA = 1000 * 650;

const Layer = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 20px;
  pointer-events: none;
`;

const Fog = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, var(--fog) 0%, color-mix(in srgb, var(--fog) 55%, transparent) 100%);
`;

const drift = keyframes`
  from { transform: translateX(-30%); }
  to { transform: translateX(110%); }
`;

/** A full-width lane each cloud drifts along; it's clipped at the map's edges. */
const CloudLane = styled.div`
  position: absolute;
  inset: 0;
  animation: ${drift} linear infinite;

  ${media.reducedMotion} { animation: none; }
`;

const Cloud = styled.svg`
  position: absolute;
  left: 0;
  overflow: visible;
`;

const flash = keyframes`
  0%, 94%, 100% { opacity: 0; }
  96% { opacity: .28; }
`;

// One slow, soft brightening every 23 seconds: never a strobe.
const Lightning = styled.div`
  position: absolute;
  inset: 0;
  background: #f4f6ff;
  opacity: 0;
  animation: ${flash} 23s ease-in-out infinite;
  animation-delay: 6s;

  ${media.reducedMotion} { display: none; }
`;

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`;

/** Where clouds sit across the map, as shares of it, and how long each takes to cross. */
const CLOUDS = [
  { top: 2, width: 24, seconds: 150, rest: 8 },
  { top: 36, width: 18, seconds: 190, rest: 58 },
  { top: 14, width: 15, seconds: 120, rest: 78 },
  { top: 62, width: 21, seconds: 170, rest: 26 },
  { top: 48, width: 14, seconds: 210, rest: 44 },
  { top: 78, width: 17, seconds: 160, rest: 90 },
];

interface Particle {
  x: number;
  y: number;
  /** 0.5 to 1: nearer drops are bigger and faster. */
  depth: number;
  phase: number;
}

/** Rain, drizzle or snow on a canvas, or a still picture of it for reduced motion. */
function Precipitation({ kind, intensity, wind, night, still }: {
  kind: 'rain' | 'drizzle' | 'snow';
  intensity: number;
  wind: number;
  night: number;
  still: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const snow = kind === 'snow';
    const particles: Particle[] = Array.from({ length: MAX_PARTICLES[kind] }, () => ({
      x: Math.random(),
      y: Math.random(),
      depth: 0.5 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
    }));
    const colour = snow ? 'rgb(255 255 255 / .9)' : night > 0.5 ? 'rgb(205 218 255 / .5)' : 'rgb(255 255 255 / .6)';
    // Rain slants with the wind; snow drifts with it.
    const slant = 0.12 + wind * 0.45;
    let width = 0;
    let height = 0;

    function draw(dt: number, time: number) {
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const count = Math.round(particles.length * intensity * Math.min(1, (width * height) / FULL_AREA));
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineCap = 'round';
      for (let i = 0; i < count; i++) {
        const p = particles[i]!;
        if (dt) {
          const speed = (snow ? 45 : kind === 'drizzle' ? 420 : 700) * p.depth;
          const sway = snow ? Math.sin(time * 1.3 + p.phase) * 12 : 0;
          p.y += (speed * dt) / height;
          p.x += ((speed * (snow ? wind * 0.8 : slant) + sway) * dt) / width;
          if (p.y > 1.05) {
            p.y -= 1.1;
            p.x = Math.random();
          }
          if (p.x > 1.05) p.x -= 1.1;
        }
        const x = p.x * width;
        const y = p.y * height;
        if (snow) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2 + 1.8 * p.depth, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const length = (kind === 'drizzle' ? 7 : 15) * p.depth;
          ctx.lineWidth = (kind === 'drizzle' ? 1 : 1.4) * p.depth;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - length * slant, y - length);
          ctx.stroke();
        }
      }
    }

    const ratio = Math.min(devicePixelRatio, 2);
    function resize() {
      if (!canvas || !ctx) return;
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (still) draw(0, 0);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (still) return () => observer.disconnect();

    // requestAnimationFrame pauses by itself while the tab is hidden.
    let frame = 0;
    let last = 0;
    frame = requestAnimationFrame(function loop(now) {
      frame = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      draw(dt, now / 1000);
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [kind, intensity, wind, night, still]);

  return <Canvas ref={ref} />;
}

export function hasWeather({ weather }: Ambience): boolean {
  return weather.precipitation !== 'none' || weather.clouds > 0 || weather.fog > 0;
}

/**
 * Flat cartoon clouds drifting across their parent, more of them the cloudier it is.
 * The 2D map spreads them over the town; the 3D map keeps them to the sky at the top.
 */
export function Clouds({ look, reduced, sky = false }: { look: Ambience; reduced: boolean; sky?: boolean }) {
  const { weather, daylight } = look;
  const colour = mixColor(mixColor('#ffffff', '#ccd3de', weather.gloom), '#6f78a8', 1 - daylight);
  const clouds = CLOUDS.slice(0, Math.round(weather.clouds * CLOUDS.length));
  return (
    <>
      {clouds.map((cloud, i) => (
        <CloudLane
          key={i}
          style={{
            animationDuration: `${cloud.seconds}s`,
            // Spread out along their lanes from the start, instead of all coming in from the left.
            animationDelay: `${-cloud.seconds * (cloud.rest / 100)}s`,
            ...(reduced && { transform: `translateX(${cloud.rest - 10}%)` }),
          }}
        >
          <Cloud
            viewBox="0 0 100 50"
            style={{
              top: `${sky ? cloud.top * 0.22 : cloud.top}%`,
              width: `${sky ? cloud.width * 0.8 : cloud.width}%`,
              opacity: sky ? 0.9 : 0.55 + weather.clouds * 0.25,
            }}
          >
            <path
              d="M18 46C7 46 2 39 4 31c2-7 9-10 16-8 2-12 13-20 26-17 9 2 15 9 16 17 4-6 13-8 20-3 7 4 9 12 6 18 6 2 9 6 8 10-1 5-6 8-12 8Z"
              fill={colour}
            />
          </Cloud>
        </CloudLane>
      ))}
    </>
  );
}

export function Weather2D({ look, reduced }: { look: Ambience; reduced: boolean }) {
  const { weather, daylight } = look;
  const night = 1 - daylight;
  const fogColour = mixColor('#e8edf3', '#5a6290', night);

  return (
    <Layer aria-hidden="true" style={{ '--fog': fogColour } as CSSProperties}>
      <Clouds look={look} reduced={reduced} />
      {weather.fog > 0 && <Fog style={{ opacity: weather.fog * 0.8 }} />}
      {weather.precipitation !== 'none' && (
        <Precipitation kind={weather.precipitation} intensity={weather.intensity} wind={weather.wind} night={night} still={reduced} />
      )}
      {weather.storm && <Lightning />}
    </Layer>
  );
}
