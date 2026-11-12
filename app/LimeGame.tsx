"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, HudState } from "@/game/game";

const INITIAL: HudState = {
  phase: "loading",
  time: 90,
  battery: 100,
  deliveries: 0,
  speed: 0,
  destName: "",
  destStreet: "",
  destDist: 0,
  arrow: 0,
  chase: 0,
  street: "",
  outOfZone: false,
  inZone: false,
  guards: 0,
  toast: null,
  cause: "",
  causeDetail: "",
  overReady: false,
  loading: "Fetching the map of Soho…",
};

function fmtTime(t: number) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Key({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <kbd
      className={`inline-flex h-7 items-center justify-center rounded-md border border-white/25 bg-white/10 px-2 font-mono text-xs font-semibold text-white ${wide ? "min-w-16" : "min-w-7"}`}
    >
      {children}
    </kbd>
  );
}

export default function LimeGame() {
  const mountRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [hud, setHud] = useState<HudState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    let game: Game | null = null;
    void import("@/game/game").then(({ Game }) => {
      if (cancelled || !mountRef.current || !mapRef.current) return;
      game = new Game(mountRef.current, mapRef.current, (s) => {
        if (!cancelled) setHud(s);
      });
      gameRef.current = game;
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __lime?: Game }).__lime = game;
      }
    });
    return () => {
      cancelled = true;
      game?.dispose();
      gameRef.current = null;
    };
  }, []);

  const start = () => gameRef.current?.start();
  const playing = hud.phase === "playing";
  const low = hud.battery < 20;
  const urgent = hud.time < 15;
  const battColor = hud.battery > 50 ? "#7dff5a" : hud.battery > 20 ? "#ffd23f" : "#ff5a4f";

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0d1210] font-sans text-white select-none">
      <div ref={mountRef} className="absolute inset-0" />

      {/* soft vignette so the HUD sits on the picture */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(0,0,0,0.38)_100%)]" />

      {/* ---------------- HUD ---------------- */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${playing ? "opacity-100" : "opacity-0"}`}>
        <div className="absolute left-4 top-4 flex gap-2.5">
          <div className={`rounded-2xl border px-4 py-2.5 backdrop-blur-md ${urgent ? "border-red-400/60 bg-red-950/70" : "border-white/10 bg-black/55"}`}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">Time</div>
            <div className={`font-mono text-4xl font-bold tabular-nums leading-none ${urgent ? "animate-pulse text-red-300" : "text-white"}`}>
              {fmtTime(hud.time)}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/55 px-4 py-2.5 backdrop-blur-md">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">Deliveries</div>
            <div className="font-mono text-4xl font-bold tabular-nums leading-none text-[#7dff5a]">{hud.deliveries}</div>
          </div>
        </div>

        <div className="absolute right-4 top-4 w-56 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 backdrop-blur-md">
          <div className="flex items-baseline justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">Battery</div>
            <div className="font-mono text-lg font-bold tabular-nums" style={{ color: battColor }}>
              {Math.round(hud.battery)}%
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-1">
            <div className="h-3.5 flex-1 overflow-hidden rounded-[5px] border border-white/30 p-[2px]">
              <div className="h-full rounded-[2px] transition-[width] duration-200" style={{ width: `${hud.battery}%`, background: battColor }} />
            </div>
            <div className="h-2 w-[3px] rounded-r-sm bg-white/40" />
          </div>
          {low && <div className="mt-1.5 text-[11px] font-semibold text-red-300">Low battery — motor assist fading</div>}
          <div className="mt-2.5 flex items-end justify-between border-t border-white/10 pt-2">
            <div className="truncate pr-2 text-[11px] text-white/60">{hud.street || "Soho"}</div>
            <div className="font-mono text-2xl font-bold tabular-nums leading-none">
              {Math.round(hud.speed)}
              <span className="ml-1 text-[10px] font-medium text-white/50">km/h</span>
            </div>
          </div>
        </div>

        {/* destination + arrow */}
        <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#7dff5a]/30 bg-black/60 py-2 pl-2 pr-5 backdrop-blur-md">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#7dff5a]">
            <svg width="30" height="30" viewBox="0 0 24 24" style={{ transform: `rotate(${hud.arrow}deg)` }} className="transition-transform duration-100">
              <path d="M12 2.5 19.5 20 12 15.8 4.5 20Z" fill="#0b1a0b" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7dff5a]">Deliver to</div>
            <div className="max-w-64 truncate text-lg font-bold leading-tight">{hud.destName}</div>
            <div className="text-[11px] text-white/60">
              {hud.destStreet ? `${hud.destStreet} · ` : ""}
              {Math.round(hud.destDist)} m
            </div>
          </div>
        </div>

        {hud.chase > 0 && (
          <div className="absolute left-1/2 top-24 -translate-x-1/2 animate-pulse rounded-xl border border-blue-300/60 bg-blue-700/85 px-5 py-2 text-center shadow-[0_0_40px_rgba(59,130,246,0.6)]">
            <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-blue-100">Police in pursuit</div>
            <div className="font-mono text-2xl font-bold tabular-nums">{hud.chase.toFixed(1)}s</div>
          </div>
        )}

        {hud.chase <= 0 && (hud.inZone || hud.guards > 0) && (
          <div className={`absolute left-1/2 top-24 -translate-x-1/2 rounded-xl border px-5 py-2 text-center ${hud.guards > 0 ? "animate-pulse border-yellow-200/70 bg-yellow-400/95 text-black shadow-[0_0_40px_rgba(250,204,21,0.55)]" : "border-yellow-300/50 bg-black/70 text-yellow-200"}`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.25em]">{hud.guards > 0 ? "Security giving chase" : "Pedestrian zone"}</div>
            <div className="text-sm font-bold">{hud.guards > 0 ? "Get out of the zone!" : "No cycling on Oxford Street"}</div>
          </div>
        )}

        {hud.toast && (
          <div
            key={hud.toast.id}
            className={`toast absolute left-1/2 top-[30%] -translate-x-1/2 rounded-full px-5 py-2 text-base font-bold shadow-xl ${
              hud.toast.tone === "good" ? "bg-[#7dff5a] text-[#0b1a0b]" : hud.toast.tone === "bad" ? "bg-red-500 text-white" : "bg-white/90 text-black"
            }`}
          >
            {hud.toast.text}
          </div>
        )}

        <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[11px] text-white/70 backdrop-blur-sm">
          <Key>W</Key>
          <Key>A</Key>
          <Key>S</Key>
          <Key>D</Key>
          <span className="mx-1">ride</span>
          <Key wide>Space</Key>
          <span className="ml-1">brake</span>
        </div>
      </div>

      {/* minimap stays mounted so the game can draw into it */}
      <div className={`pointer-events-none absolute bottom-4 left-4 transition-opacity duration-500 ${playing ? "opacity-100" : "opacity-0"}`}>
        <canvas ref={mapRef} className="h-[190px] w-[190px] rounded-full border-2 border-white/25 shadow-2xl" />
      </div>

      <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-white/40">
        Map data © OpenStreetMap contributors
      </div>

      {/* ---------------- overlays ---------------- */}
      {(hud.phase === "loading" || hud.phase === "error") && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-[#0d1210]">
          <div className="text-5xl font-black tracking-tight">
            <span className="text-[#7dff5a]">Lime</span> Bike Simulator
          </div>
          <div className="text-sm uppercase tracking-[0.4em] text-white/50">Soho</div>
          {hud.phase === "loading" && <div className="h-1 w-56 overflow-hidden rounded-full bg-white/10"><div className="loadbar h-full w-1/3 rounded-full bg-[#7dff5a]" /></div>}
          <div className={`text-sm ${hud.phase === "error" ? "text-red-300" : "text-white/60"}`}>{hud.loading}</div>
        </div>
      )}

      {hud.phase === "menu" && (
        <div className="absolute inset-0 flex items-end justify-start bg-gradient-to-t from-black/80 via-black/20 to-black/30 p-8 sm:p-12">
          <div className="max-w-xl">
            <div className="mb-2 inline-block rounded-full bg-[#7dff5a] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-[#0b1a0b]">
              Oxford Circus · W1
            </div>
            <h1 className="text-6xl font-black leading-[0.95] tracking-tight drop-shadow-lg sm:text-7xl">
              <span className="text-[#7dff5a]">Lime</span> Bike
              <br />
              Simulator: Soho
            </h1>
            <p className="mt-4 max-w-md text-base leading-relaxed text-white/85">
              Ninety seconds, one hire bike, and a real map of Soho. Get each order to the glowing pin before the clock runs out.
            </p>
            <ul className="mt-4 grid max-w-md grid-cols-1 gap-1.5 text-sm text-white/75">
              <li>🚌 Buses on Regent Street and the open end of Oxford Street do not stop for you.</li>
              <li>🚦 You can jump a red — but people cross on red, and the police are watching.</li>
              <li>🚷 Oxford Street west of Great Portland Street is traffic-free now. Security will run you down.</li>
              <li>🔋 The battery drains as you ride. Grab the green cells.</li>
            </ul>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <button
                onClick={start}
                className="pointer-events-auto cursor-pointer rounded-full bg-[#7dff5a] px-8 py-3.5 text-lg font-extrabold text-[#0b1a0b] shadow-[0_8px_30px_rgba(125,255,90,0.35)] transition hover:scale-[1.03] hover:bg-[#9bff80] active:scale-95"
              >
                Unlock &amp; ride
              </button>
              <div className="flex items-center gap-1.5 text-xs text-white/70">
                <Key>W</Key>
                <Key>A</Key>
                <Key>S</Key>
                <Key>D</Key>
                <span className="mx-1">or arrows</span>
                <Key wide>Space</Key>
                <span>brake</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {hud.phase === "over" && !hud.overReady && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 text-center">
          <div className="inline-block rounded-full bg-black/60 px-6 py-2 text-3xl font-black tracking-tight text-white shadow-xl backdrop-blur-sm">{hud.cause}</div>
        </div>
      )}

      {hud.phase === "over" && hud.overReady && (
        <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-black/10 to-transparent pb-8 sm:items-center sm:justify-end sm:pb-0 sm:pr-10">
          <div className="overcard w-[min(92vw,26rem)] rounded-3xl border border-white/10 bg-[#101613]/92 p-7 text-center shadow-2xl backdrop-blur-md">
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-red-400">Ride ended</div>
            <h2 className="mt-2 text-4xl font-black leading-tight tracking-tight">{hud.cause}</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-white/65">{hud.causeDetail}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/5 py-3">
                <div className="font-mono text-4xl font-bold text-[#7dff5a]">{hud.deliveries}</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Deliveries</div>
              </div>
              <div className="rounded-2xl bg-white/5 py-3">
                <div className="font-mono text-4xl font-bold">{Math.round(hud.battery)}%</div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Battery left</div>
              </div>
            </div>
            <button
              onClick={start}
              className="mt-6 w-full cursor-pointer rounded-full bg-[#7dff5a] py-3.5 text-lg font-extrabold text-[#0b1a0b] transition hover:bg-[#9bff80] active:scale-[0.98]"
            >
              Ride again
            </button>
            <div className="mt-2 text-[11px] text-white/40">or press Enter</div>
          </div>
        </div>
      )}
    </div>
  );
}
