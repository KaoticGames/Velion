import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/store/authStore';
import { buildDiceBreakdown, type AdvantageKeep } from '@/lib/diceBreakdown';
import {
  buildAnimationSpecFromPhysicsResults,
  type DiceAnimationFace,
} from '@/lib/diceAnimationSpec';
import type { DiceResult } from '@/vtt/types';

/** Remote viewers: “tumble” time before authoritative faces + dice log line appear. */
const IMMERSIVE_SETTLE_MS = 2000;
/** After settle, keep the summary card visible before clearing. */
const IMMERSIVE_HOLD_MS = 3200;

type DiceVisibility = 'public' | 'private' | 'dm';
type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

type RollContext = {
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
  forcedLabel?: string;
  source_label?: string;
  /** e.g. `2d20 + 1d6` — same toss the roller used (for network 3D replay). */
  physics_notation?: string;
  /** Correlates `dice:roll_start` with the final `dice:roll` on the server. */
  roll_id?: string;
  /** Passed through to velion:dice-roll-complete for sheet UI */
  requestMeta?: Record<string, unknown>;
};

export type ExternalRollRequest = {
  formula?: string;
  label?: string;
  visibility?: DiceVisibility;
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
  source_label?: string;
  autoOpen?: boolean;
  requestMeta?: Record<string, unknown>;
};

const CDN = 'https://unpkg.com/@3d-dice/dice-box@1.0.8/dist/';

const T = {
  surface: '#0d1018',
  card: '#111520',
  border: '#1c2230',
  gold: '#c4922a',
  text: '#e4d8c0',
  textMuted: '#8a7a68',
  textDim: '#504538',
  green: '#50a060',
  hp: '#d45c5c',
};

const DICE: Array<{ type: DiceType; label: string }> = [
  { type: 'd4', label: 'D4' },
  { type: 'd6', label: 'D6' },
  { type: 'd8', label: 'D8' },
  { type: 'd10', label: 'D10' },
  { type: 'd12', label: 'D12' },
  { type: 'd20', label: 'D20' },
  { type: 'd100', label: 'D%' },
];

const VIS_CFG: Record<DiceVisibility, { label: string; color: string }> = {
  public: { label: 'PUBLIC', color: T.green },
  private: { label: 'PRIVATE', color: '#3ab5e8' },
  dm: { label: 'DM', color: T.gold },
};

let sharedBox: any = null;
let boxInitPending = false;

function teardownSharedDiceBox(): void {
  if (!sharedBox) return;
  try {
    sharedBox.clear?.();
    const end = sharedBox.dispose ?? sharedBox.destroy;
    if (typeof end === 'function') end.call(sharedBox);
  } catch {
    /* best-effort teardown */
  }
  sharedBox = null;
  boxInitPending = false;
}

function summarise(dice: DiceType[]): string {
  const counts = new Map<DiceType, number>();
  dice.forEach((die) => counts.set(die, (counts.get(die) ?? 0) + 1));
  return [...counts.entries()].map(([die, qty]) => `${qty}${die}`).join(' + ');
}

function parseDiceFromFormula(formula?: string): DiceType[] {
  if (!formula) return [];
  const out: DiceType[] = [];
  // Strip breakdown tail (e.g. "2d20 + 4 = 24") — keep only NdS chunks before "="
  const dicePortion = formula.split('=')[0] ?? formula;
  const rx = /(\d*)\s*[dD]\s*(4|6|8|10|12|20|100)/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(dicePortion)) !== null) {
    const rawQty = match[1];
    const qty = rawQty === '' ? 1 : Number.parseInt(rawQty, 10);
    if (!Number.isFinite(qty) || qty < 1) continue;
    const die = `d${match[2]}` as DiceType;
    for (let i = 0; i < Math.max(0, Math.min(qty, 30)); i += 1) out.push(die);
  }
  return out;
}

function deriveRevealFaces(entry: DiceResult): DiceAnimationFace[] {
  if (entry.animation_spec?.length) return entry.animation_spec;
  const parsed = parseDiceFromFormula(entry.formula);
  const fromResults = Array.isArray(entry.results)
    ? entry.results
        .filter((v) => Number.isFinite(v))
        .map((value, i) => {
          const die = parsed[i] ?? 'd20';
          const sides = Number.parseInt(die.slice(1), 10);
          return {
            sides: Number.isFinite(sides) && sides > 0 ? sides : 20,
            value,
          };
        })
    : [];
  if (fromResults.length) return fromResults;
  return [{ sides: 20, value: entry.total }];
}

function isDiceOverlayRoute(pathname: string): boolean {
  return pathname.startsWith('/vtt/')
    || pathname === '/characters/new'
    || /^\/characters\/[^/]+$/.test(pathname);
}

export default function GlobalDiceOverlay() {
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DiceType[]>([]);
  const [results, setResults] = useState<number[]>([]);
  const [rolling, setRolling] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [label, setLabel] = useState('');
  const [visibility, setVisibility] = useState<DiceVisibility>('public');
  const [errorMsg, setErrorMsg] = useState('');
  const [queuedExternalRoll, setQueuedExternalRoll] = useState<ExternalRollRequest | null>(null);
  const [routeEnabled, setRouteEnabled] = useState(() => isDiceOverlayRoute(window.location.pathname));
  /** Dice canvas visible while rolling or shortly after (independent of control panel) */
  const [diceSceneActive, setDiceSceneActive] = useState(false);
  /** Bumped when dice-box (re)initialises so queued sheet rolls retry after StrictMode teardown. */
  const [boxVersion, setBoxVersion] = useState(0);
  const diceSceneTimerRef = useRef<number | null>(null);
  /** This tab’s current physical roll (skip duplicate `dice:roll_start` from the server). */
  const activePhysicsRollIdRef = useRef<string | null>(null);
  /** Rolls completed locally in 3D; skip network “reveal” for the same `roll_id`. */
  const physicsSourceRollIdsRef = useRef<Set<string>>(new Set());
  const [networkWait, setNetworkWait] = useState<{
    roll_id: string;
    label: string;
    source_label: string | null;
  } | null>(null);
  const [networkReveal, setNetworkReveal] = useState<{
    formula: string;
    label: string;
    total: number;
    source_label: string | null;
    animation_spec: DiceAnimationFace[];
    hideNumbers: boolean;
  } | null>(null);
  const networkRevealTimerRef = useRef<number | null>(null);
  const networkRevealDismissTimerRef = useRef<number | null>(null);
  /** Dedupe `velion:dice-log-commit` if the same roll is processed twice. */
  const committedDiceLogIdsRef = useRef<Set<string>>(new Set());

  const pendingRef = useRef<DiceType[]>([]);
  const labelRef = useRef('');
  const visibilityRef = useRef<DiceVisibility>('public');
  const rollContextRef = useRef<RollContext>({});

  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => { labelRef.current = label; }, [label]);
  useEffect(() => { visibilityRef.current = visibility; }, [visibility]);

  const rollingRef = useRef(rolling);
  const statusRef = useRef(status);
  const routeEnabledRef = useRef(routeEnabled);
  rollingRef.current = rolling;
  statusRef.current = status;
  routeEnabledRef.current = routeEnabled;

  const clearDiceSceneTimer = () => {
    if (diceSceneTimerRef.current != null) {
      window.clearTimeout(diceSceneTimerRef.current);
      diceSceneTimerRef.current = null;
    }
  };

  /** Fade scrim + remove mesh from the shared WebGL context (last frame otherwise stays forever). */
  const hideFullScreenDiceScene = () => {
    try {
      sharedBox?.clear?.();
    } catch {
      /* ignore */
    }
    setDiceSceneActive(false);
    setResults([]);
  };

  const clearNetworkRevealTimer = () => {
    if (networkRevealTimerRef.current != null) {
      window.clearTimeout(networkRevealTimerRef.current);
      networkRevealTimerRef.current = null;
    }
    if (networkRevealDismissTimerRef.current != null) {
      window.clearTimeout(networkRevealDismissTimerRef.current);
      networkRevealDismissTimerRef.current = null;
    }
  };

  const commitDiceLogEntry = (entry: DiceResult) => {
    const key =
      entry.roll_id?.trim() ||
      `${entry.roller_id}\0${entry.formula}\0${entry.total}\0${JSON.stringify(entry.results)}`;
    if (committedDiceLogIdsRef.current.has(key)) return;
    committedDiceLogIdsRef.current.add(key);
    if (committedDiceLogIdsRef.current.size > 200) {
      committedDiceLogIdsRef.current.clear();
    }
    window.dispatchEvent(new CustomEvent('velion:dice-log-commit', { detail: entry }));
  };

  useEffect(() => {
    const syncSession = () => {
      setRouteEnabled(isDiceOverlayRoute(window.location.pathname));
    };

    syncSession();
    const intervalId = window.setInterval(syncSession, 500);
    window.addEventListener('focus', syncSession);
    window.addEventListener('storage', syncSession);
    window.addEventListener('popstate', syncSession);
    document.addEventListener('visibilitychange', syncSession);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncSession);
      window.removeEventListener('storage', syncSession);
      window.removeEventListener('popstate', syncSession);
      document.removeEventListener('visibilitychange', syncSession);
      clearDiceSceneTimer();
    };
  }, []);

  // Another client (or this user’s VTT tab) is rolling — show the same “rolling” dim at the same time
  useEffect(() => {
    const onSessionDiceRollStart = (event: Event) => {
      const d = (event as CustomEvent<{
        roll_id?: string;
        roller_id?: string;
        label?: string;
        source_label?: string | null;
      }>).detail;
      if (!d?.roll_id || !routeEnabledRef.current) return;
      const me = useAuthStore.getState().user?.id ?? '';
      if (d.roller_id && me && d.roller_id === me && d.roll_id === activePhysicsRollIdRef.current) {
        return;
      }
      setNetworkWait({ roll_id: d.roll_id, label: d.label || 'Roll', source_label: d.source_label ?? null });
      setDiceSceneActive(true);
    };
    window.addEventListener('velion:session-dice-roll-start', onSessionDiceRollStart as EventListener);
    return () => window.removeEventListener('velion:session-dice-roll-start', onSessionDiceRollStart as EventListener);
  }, []);

  /**
   * Single entry point for socket `dice:result`: defer dice log until immersive reveal finishes,
   * or commit immediately when this tab ran physics / there is nothing to animate.
   */
  useEffect(() => {
    const onDiceResultPending = (event: Event) => {
      const entry = (event as CustomEvent<DiceResult>).detail;
      if (!entry) return;

      if (!routeEnabledRef.current) {
        commitDiceLogEntry(entry);
        return;
      }

      if (entry.roll_id && physicsSourceRollIdsRef.current.has(entry.roll_id)) {
        if (entry.roll_id) setNetworkWait((w) => (w?.roll_id === entry.roll_id ? null : w));
        commitDiceLogEntry(entry);
        return;
      }

      clearNetworkRevealTimer();
      if (entry.roll_id) {
        setNetworkWait((w) => (w?.roll_id === entry.roll_id ? null : w));
      } else {
        setNetworkWait(null);
      }
      const revealFaces = deriveRevealFaces(entry);

      setNetworkReveal({
        formula: entry.formula,
        label: entry.label,
        total: entry.total,
        source_label: entry.source_label ?? null,
        animation_spec: revealFaces,
        hideNumbers: true,
      });
      setDiceSceneActive(true);

      networkRevealTimerRef.current = window.setTimeout(() => {
        networkRevealTimerRef.current = null;
        setNetworkReveal((r) => (r ? { ...r, hideNumbers: false } : null));
        commitDiceLogEntry(entry);
      }, IMMERSIVE_SETTLE_MS);

      networkRevealDismissTimerRef.current = window.setTimeout(() => {
        networkRevealDismissTimerRef.current = null;
        setNetworkReveal(null);
        setNetworkWait(null);
        setDiceSceneActive(false);
        try {
          sharedBox?.clear?.();
        } catch {
          /* ignore */
        }
        setResults([]);
      }, IMMERSIVE_SETTLE_MS + IMMERSIVE_HOLD_MS);
    };
    window.addEventListener('velion:dice-result-pending', onDiceResultPending as EventListener);
    return () => {
      clearNetworkRevealTimer();
      window.removeEventListener('velion:dice-result-pending', onDiceResultPending as EventListener);
    };
  }, []);

  const onRollComplete = (rawResults: any[]) => {
    const d100Count = (sharedBox?._d100Count ?? 0) as number;
    if (sharedBox) sharedBox._d100Count = 0;

    const valid = rawResults.filter((r: any) => r.value > 0);
    const animation_spec = buildAnimationSpecFromPhysicsResults(valid, d100Count);
    const d10 = valid.filter((r: any) => r.sides === 10);
    const d100 = valid.filter((r: any) => r.sides === 100);
    const others = valid.filter((r: any) => r.sides !== 10 && r.sides !== 100);

    const mapped: number[] = [];
    for (let i = 0; i < d100Count; i += 1) {
      const pct = d100.shift();
      const units = d10.shift();
      if (!pct || !units) continue;
      const tens = pct.value;
      const unit = units.value;
      mapped.push(tens === 0 && unit === 10 ? 100 : tens + (unit === 10 ? 0 : unit));
    }
    d10.forEach((die: any) => mapped.push(die.value));
    others.forEach((die: any) => mapped.push(die.value));

    setRolling(false);
    setPending([]);

    const context = { ...rollContextRef.current };
    rollContextRef.current = {};

    const breakdown = buildDiceBreakdown({
      faces: mapped,
      modifier: context.modifier,
      postMultiplier: context.postMultiplier,
      advantageKeep: context.advantageKeep,
    });

    setResults(breakdown.results);

    if (context.roll_id) {
      physicsSourceRollIdsRef.current.add(context.roll_id);
    }
    activePhysicsRollIdRef.current = null;

    const payload = {
      formula: breakdown.formula,
      label: context.forcedLabel || labelRef.current || 'Dice Roll',
      visibility: visibilityRef.current,
      results: breakdown.results,
      total: breakdown.total,
      source_label: context.source_label ?? user?.email ?? 'Player',
      requestMeta: context.requestMeta,
      animation_spec,
      physics_notation: context.physics_notation,
      roll_id: context.roll_id,
    };

    window.dispatchEvent(new CustomEvent('velion:dice-roll-submit', { detail: payload }));
    window.dispatchEvent(new CustomEvent('velion:dice-roll-complete', { detail: payload }));

    clearDiceSceneTimer();
    diceSceneTimerRef.current = window.setTimeout(() => {
      diceSceneTimerRef.current = null;
      hideFullScreenDiceScene();
    }, 4200);
  };

  useEffect(() => {
    if (sharedBox) sharedBox.onRollComplete = onRollComplete;
  }, [onRollComplete]);

  const ensureBox = async (): Promise<void> => {
    if (sharedBox) {
      sharedBox.onRollComplete = onRollComplete;
      setStatus('ready');
      setBoxVersion((v) => v + 1);
      return;
    }
    if (boxInitPending) return;
    boxInitPending = true;

    try {
      const { default: DiceBox } = await import(/* @vite-ignore */ `${CDN}dice-box.es.min.js`);
      const host = document.getElementById('global-dice-canvas-host');
      if (!host) throw new Error('global dice host unavailable');

      const width = host.offsetWidth || window.innerWidth;
      const height = host.offsetHeight || window.innerHeight;
      const box = new DiceBox('#global-dice-canvas-host', {
        assetPath: 'assets/',
        origin: CDN,
        theme: 'default',
        offscreen: false,
        width,
        height,
        scale: 7,
        gravity: 1,
        mass: 1,
        friction: 0.8,
        restitution: 0.5,
        angularDamping: 0.4,
        linearDamping: 0.4,
        spinForce: 6,
        throwForce: 4,
        settleTimeout: 5000,
        themeColor: T.gold,
      });
      box.onRollComplete = onRollComplete;
      await box.init();

      const canvas = host.querySelector('canvas') as HTMLCanvasElement | null;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.style.zIndex = '0';
        canvas.style.pointerEvents = 'none';
      }

      sharedBox = box;
      boxInitPending = false;
      setStatus('ready');
      setBoxVersion((v) => v + 1);
    } catch (err: unknown) {
      boxInitPending = false;
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!routeEnabled) {
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      setStatus('loading');
      teardownSharedDiceBox();
      return;
    }
    void ensureBox();
    const onResize = () => {
      if (!sharedBox) return;
      const host = document.getElementById('global-dice-canvas-host');
      if (!host) return;
      const canvas = host.querySelector('canvas') as HTMLCanvasElement | null;
      const width = host.offsetWidth || window.innerWidth;
      const height = host.offsetHeight || window.innerHeight;
      if (canvas) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      setStatus('loading');
      teardownSharedDiceBox();
    };
  }, [routeEnabled]);

  const canRoll = useMemo(() => pending.length > 0 && !rolling && status === 'ready', [pending.length, rolling, status]);

  const startPhysicalRoll = (dice: DiceType[], context: RollContext = {}) => {
    if (!sharedBox || !dice.length || rolling || status !== 'ready') return false;
    const rollId =
      typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    activePhysicsRollIdRef.current = rollId;
    const physicsNot = summarise(dice);
    rollContextRef.current = { ...context, physics_notation: physicsNot, roll_id: rollId };
    window.dispatchEvent(
      new CustomEvent('velion:dice-roll-network-start', {
        detail: {
          roll_id: rollId,
          physics_notation: physicsNot,
          label: context.forcedLabel || labelRef.current || 'Dice Roll',
          visibility: visibilityRef.current,
          source_label: context.source_label ?? user?.email ?? 'Player',
        },
      }),
    );
    setRolling(true);
    setDiceSceneActive(true);
    clearDiceSceneTimer();
    setResults([]);
    setPending(dice);
    try {
      sharedBox.clear?.();
    } catch {
      /* ignore */
    }
    const d100Count = dice.filter((die) => die === 'd100').length;
    const counts = new Map<number, number>();
    dice.forEach((die) => {
      if (die === 'd100') return;
      const sides = Number.parseInt(die.slice(1), 10);
      counts.set(sides, (counts.get(sides) ?? 0) + 1);
    });
    sharedBox._d100Count = d100Count;
    if (d100Count > 0) {
      counts.set(100, (counts.get(100) ?? 0) + d100Count);
      counts.set(10, (counts.get(10) ?? 0) + d100Count);
    }
    const rollArg = [...counts.entries()].map(([sides, qty]) => ({ qty, sides }));
    const throwDice = () => {
      const b = sharedBox;
      if (!b) {
        setRolling(false);
        setDiceSceneActive(false);
        rollContextRef.current = {};
        return;
      }
      try {
        b.roll(rollArg);
      } catch {
        setRolling(false);
        setDiceSceneActive(false);
        rollContextRef.current = {};
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(throwDice);
    });
    return true;
  };

  const roll = () => {
    if (!canRoll) return;
    const started = startPhysicalRoll(pending, {
      forcedLabel: labelRef.current || undefined,
      source_label: user?.email ?? 'Player',
    });
    if (started) setOpen(false);
  };

  const total = results.reduce((sum, value) => sum + value, 0);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<ExternalRollRequest>;
      const request = custom.detail ?? {};
      setQueuedExternalRoll(request);
      if (request.autoOpen !== false) setOpen(true);
    };
    window.addEventListener('velion:dice-roll-request', handler as EventListener);
    return () => window.removeEventListener('velion:dice-roll-request', handler as EventListener);
  }, []);

  useEffect(() => {
    if (!queuedExternalRoll || status !== 'ready' || rolling || !routeEnabled) return;
    const parsed = parseDiceFromFormula(queuedExternalRoll.formula);
    const fallbackCount = 1;
    const diceToRoll = parsed.length ? parsed : Array.from({ length: fallbackCount }, () => 'd20' as DiceType);
    const started = startPhysicalRoll(diceToRoll, {
      modifier: queuedExternalRoll.modifier,
      postMultiplier: queuedExternalRoll.postMultiplier,
      advantageKeep: queuedExternalRoll.advantageKeep,
      forcedLabel: queuedExternalRoll.label,
      source_label: queuedExternalRoll.source_label,
      requestMeta: queuedExternalRoll.requestMeta,
    });
    if (started) {
      setLabel(queuedExternalRoll.label ?? '');
      if (queuedExternalRoll.visibility) setVisibility(queuedExternalRoll.visibility);
      setQueuedExternalRoll(null);
    }
  }, [queuedExternalRoll, status, rolling, routeEnabled, boxVersion]);

  if (!routeEnabled) return null;

  return createPortal(
    <>
      {/* Full-screen dice: keep WebGL host at opacity 1 — hiding the parent breaks many drivers; fade only the scrim. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 24000, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            opacity: diceSceneActive ? 1 : 0,
            transition: 'opacity 0.18s ease',
            pointerEvents: 'none',
            background: diceSceneActive
              ? 'radial-gradient(circle at 50% 45%, rgba(0,0,0,0.12), rgba(0,0,0,0.55) 70%)'
              : 'transparent',
          }}
        />
        <div id="global-dice-canvas-host" style={{ position: 'absolute', inset: 0, opacity: 1, pointerEvents: 'none' }} />
      </div>

      {networkWait && !networkReveal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 24500,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.28em', color: T.gold }}>
            ROLL IN PROGRESS
          </span>
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: '14px', color: T.text }}>
            {networkWait.source_label?.trim() || 'Player'}
          </span>
          <span style={{ fontSize: '12px', color: T.textMuted, maxWidth: 'min(90vw, 420px)', textAlign: 'center' }}>{networkWait.label}</span>
        </div>
      )}

      {networkReveal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 25600,
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'radial-gradient(circle at 50% 40%, rgba(0,0,0,0.15), rgba(0,0,0,0.58) 75%)',
          }}
        >
          <style>
            {`
            @keyframes velion-dice-tumble {
              0%, 100% { transform: rotate(-3deg) translateY(0); opacity: 0.7; }
              50% { transform: rotate(3deg) translateY(-2px); opacity: 1; }
            }
            @keyframes velion-dice-land {
              0% { transform: scale(0.6); opacity: 0; }
              70% { transform: scale(1.08); }
              100% { transform: scale(1); opacity: 1; }
            }
            `}
          </style>
          <div
            style={{
              maxWidth: 'min(92vw, 720px)',
              padding: '20px 22px',
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: '10px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
            }}
          >
            <div
              style={{
                fontFamily: "'Cinzel',serif",
                fontSize: '10px',
                letterSpacing: '0.22em',
                color: T.gold,
                marginBottom: '10px',
              }}
            >
              ROLL · {networkReveal.source_label?.trim() || 'Player'}
            </div>
            {networkReveal.label && (
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', color: T.text, marginBottom: '14px' }}>{networkReveal.label}</div>
            )}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
                justifyContent: 'center',
                marginBottom: '14px',
              }}
            >
              {networkReveal.animation_spec.map((f, i) => (
                <div
                  key={`${f.sides}-${f.value}-${i}`}
                  style={{
                    minWidth: '72px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    border: `1px solid ${T.gold}44`,
                    background: 'rgba(196,146,42,0.08)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '9px', color: T.textMuted, letterSpacing: '0.12em', marginBottom: '4px' }}>D{f.sides}</div>
                  <div
                    style={
                      networkReveal.hideNumbers
                        ? {
                            fontFamily: "'Cinzel',serif",
                            fontSize: '28px',
                            fontWeight: 700,
                            color: T.gold,
                            animation: 'velion-dice-tumble 0.85s ease-in-out infinite',
                          }
                        : {
                            fontFamily: "'Cinzel',serif",
                            fontSize: '28px',
                            fontWeight: 700,
                            color: T.gold,
                            animation: 'velion-dice-land 0.5s ease-out 1',
                          }
                    }
                  >
                    {networkReveal.hideNumbers ? '—' : f.value}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: '11px',
                color: T.textMuted,
                textAlign: 'center',
                borderTop: `1px solid ${T.border}`,
                paddingTop: '12px',
                letterSpacing: networkReveal.hideNumbers ? '0.15em' : undefined,
              }}
            >
              {networkReveal.hideNumbers ? '···' : networkReveal.formula}
            </div>
            <div
              style={{
                marginTop: '8px',
                fontFamily: "'Cinzel',serif",
                fontSize: '20px',
                fontWeight: 700,
                color: T.text,
                textAlign: 'center',
              }}
            >
              {networkReveal.hideNumbers ? '···' : networkReveal.total}
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Global dice dock"
        style={{
          position: 'fixed',
          left: '16px',
          bottom: '16px',
          zIndex: 25000,
          width: '54px',
          height: '54px',
          borderRadius: '8px',
          border: `1px solid ${open ? T.gold : T.border}`,
          background: open ? `${T.gold}22` : T.card,
          color: open ? T.gold : T.textMuted,
          fontSize: '28px',
          cursor: 'pointer',
          boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        }}
      >
        🎲
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            left: '16px',
            bottom: '82px',
            zIndex: 25000,
            width: '340px',
            background: 'rgba(17,21,32,0.94)',
            backdropFilter: 'blur(7px)',
            border: `1px solid ${T.border}`,
            borderRadius: '8px',
            boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: "'Cinzel',serif", letterSpacing: '0.12em', fontSize: '11px', color: T.text }}>
              GLOBAL DICE
            </span>
            <span style={{ fontSize: '9px', color: status === 'ready' ? T.green : status === 'error' ? T.hp : T.textDim }}>
              {status === 'ready' ? 'READY' : status === 'error' ? 'ERROR' : 'LOADING'}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
            {DICE.map((die) => {
              const count = pending.filter((value) => value === die.type).length;
              return (
                <button
                  type="button"
                  key={die.type}
                  onClick={() => setPending((prev) => [...prev, die.type])}
                  disabled={rolling || status !== 'ready'}
                  style={{
                    border: `1px solid ${count > 0 ? T.gold : T.border}`,
                    background: count > 0 ? `${T.gold}1e` : 'transparent',
                    borderRadius: '4px',
                    color: count > 0 ? T.gold : T.textMuted,
                    fontSize: '11px',
                    letterSpacing: '0.06em',
                    padding: '8px 0',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  {die.label}
                  {count > 0 && (
                    <span style={{ position: 'absolute', right: '4px', top: '2px', fontSize: '9px' }}>x{count}</span>
                  )}
                </button>
              );
            })}
          </div>

          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Roll label (optional)"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '7px 9px',
              background: T.surface,
              border: `1px solid ${T.border}`,
              borderRadius: '4px',
              color: T.text,
              fontSize: '12px',
              outline: 'none',
            }}
          />

          <div style={{ display: 'flex', gap: '6px' }}>
            {(Object.keys(VIS_CFG) as DiceVisibility[]).map((mode) => (
              <button
                type="button"
                key={mode}
                onClick={() => setVisibility(mode)}
                style={{
                  flex: 1,
                  borderRadius: '4px',
                  border: `1px solid ${visibility === mode ? VIS_CFG[mode].color : T.border}`,
                  background: visibility === mode ? `${VIS_CFG[mode].color}1e` : 'transparent',
                  color: visibility === mode ? VIS_CFG[mode].color : T.textDim,
                  fontSize: '9px',
                  letterSpacing: '0.08em',
                  padding: '6px 0',
                  cursor: 'pointer',
                }}
              >
                {VIS_CFG[mode].label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '22px' }}>
            <span style={{ fontSize: '11px', color: T.textMuted }}>{pending.length ? summarise(pending) : '\u00A0'}</span>
            {results.length > 0 && (
              <span style={{ fontFamily: "'Cinzel',serif", fontSize: '18px', color: T.gold }}>
                {total}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={() => {
                setPending([]);
                setResults([]);
                sharedBox?.clear();
              }}
              style={{
                flex: 1,
                borderRadius: '4px',
                border: `1px solid ${T.border}`,
                background: 'transparent',
                color: T.textDim,
                padding: '7px 0',
                cursor: 'pointer',
                fontSize: '10px',
                letterSpacing: '0.08em',
              }}
            >
              CLEAR
            </button>
            <button
              type="button"
              onClick={roll}
              disabled={!canRoll}
              style={{
                flex: 2,
                borderRadius: '4px',
                border: `1px solid ${canRoll ? T.gold : T.border}`,
                background: canRoll ? `${T.gold}22` : 'transparent',
                color: canRoll ? T.gold : T.textDim,
                padding: '7px 0',
                cursor: canRoll ? 'pointer' : 'not-allowed',
                fontSize: '10px',
                letterSpacing: '0.1em',
              }}
            >
              {rolling ? 'ROLLING...' : 'ROLL'}
            </button>
          </div>

          {errorMsg && <div style={{ fontSize: '9px', color: T.hp }}>{errorMsg}</div>}
        </div>
      )}
    </>,
    document.body,
  );
}
