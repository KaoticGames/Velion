import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/store/authStore';
import { buildDiceBreakdown, type AdvantageKeep } from '@/lib/diceBreakdown';
import { buildAnimationSpecFromPhysicsResults } from '@/lib/diceAnimationSpec';
import type { DiceResult } from '@/vtt/types';
import { parseDiceFromFormula, summariseDiceNotation } from '@/lib/diceFormula';

/** After local physics finishes (`onRollComplete`), keep the dice canvas visible before clearing. */
const LOCAL_ROLL_SCENE_HOLD_MS = 2000;

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
  return summariseDiceNotation(dice);
}

/** Character sheet view: `/characters/:id` (not `/characters/new`). */
function isCharacterSheetPagePath(pathname: string): boolean {
  return /^\/characters\/(?!new$)[^/]+$/.test(pathname);
}

/** Routes that use dice-box + full-screen / reveal UI (VTT + character wizard). */
function isImmersiveDiceRoute(pathname: string): boolean {
  return pathname.startsWith('/vtt/') || pathname === '/characters/new';
}

/** Any route that participates in the global dice pipeline (sheet, VTT, wizard). */
function isDiceRollRoute(pathname: string): boolean {
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
  const [diceRollActive, setDiceRollActive] = useState(() => isDiceRollRoute(window.location.pathname));
  const [immersiveDiceActive, setImmersiveDiceActive] = useState(() =>
    isImmersiveDiceRoute(window.location.pathname),
  );
  const [characterSheetLogOnly, setCharacterSheetLogOnly] = useState(() =>
    isCharacterSheetPagePath(window.location.pathname),
  );
  /** Babylon dice-box loads for VTT / wizard routes and saved character sheets (`/characters/:id`). */
  const physicsDiceActive = immersiveDiceActive || characterSheetLogOnly;
  /** Dice canvas visible while rolling or shortly after (independent of control panel) */
  const [diceSceneActive, setDiceSceneActive] = useState(false);
  /** Bumped when dice-box (re)initialises so queued sheet rolls retry after StrictMode teardown. */
  const [boxVersion, setBoxVersion] = useState(0);
  const diceSceneTimerRef = useRef<number | null>(null);
  /** This tab’s current physical roll (skip duplicate `dice:roll_start` from the server). */
  const activePhysicsRollIdRef = useRef<string | null>(null);
  /** Rolls completed locally in 3D; skip network duplicate handling for the same `roll_id`. */
  const physicsSourceRollIdsRef = useRef<Set<string>>(new Set());
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
  const diceRollActiveRef = useRef(diceRollActive);
  rollingRef.current = rolling;
  statusRef.current = status;
  diceRollActiveRef.current = diceRollActive;

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
      const path = window.location.pathname;
      setDiceRollActive(isDiceRollRoute(path));
      setImmersiveDiceActive(isImmersiveDiceRoute(path));
      setCharacterSheetLogOnly(isCharacterSheetPagePath(path));
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

  /**
   * Socket `dice:result` → `velion:dice-result-pending`: commit to dice log only (no summary overlay).
   */
  useEffect(() => {
    const onDiceResultPending = (event: Event) => {
      const entry = (event as CustomEvent<DiceResult>).detail;
      if (!entry) return;

      commitDiceLogEntry(entry);

      if (!diceRollActiveRef.current) return;

      const isOwnPhysics = entry.roll_id && physicsSourceRollIdsRef.current.has(entry.roll_id);
      if (isOwnPhysics) return;

      try {
        sharedBox?.clear?.();
      } catch {
        /* ignore */
      }
      setDiceSceneActive(false);
      setResults([]);
    };
    window.addEventListener('velion:dice-result-pending', onDiceResultPending as EventListener);
    return () => {
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

    if (isCharacterSheetPagePath(window.location.pathname)) {
      commitDiceLogEntry({
        roller_id: user?.id ?? '',
        source_label: payload.source_label ?? null,
        formula: payload.formula,
        results: payload.results,
        total: payload.total,
        label: payload.label,
        visibility: payload.visibility as DiceVisibility,
        animation_spec: payload.animation_spec,
        physics_notation: payload.physics_notation,
        roll_id: payload.roll_id,
      });
    }

    clearDiceSceneTimer();
    diceSceneTimerRef.current = window.setTimeout(() => {
      diceSceneTimerRef.current = null;
      hideFullScreenDiceScene();
    }, LOCAL_ROLL_SCENE_HOLD_MS);
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
    if (!diceRollActive) {
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      setStatus('loading');
      teardownSharedDiceBox();
      return;
    }
    if (!physicsDiceActive) {
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      teardownSharedDiceBox();
      setStatus('ready');
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
  }, [diceRollActive, physicsDiceActive]);

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
    if (!queuedExternalRoll || status !== 'ready' || rolling || !diceRollActive) return;
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
  }, [queuedExternalRoll, status, rolling, diceRollActive, boxVersion]);

  if (!diceRollActive) return null;

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

      {immersiveDiceActive && (
      <>
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
          fontSize: '31px',
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
            <span style={{ fontFamily: "'Cinzel',serif", letterSpacing: '0.12em', fontSize: '14px', color: T.text }}>
              GLOBAL DICE
            </span>
            <span style={{ fontSize: '12px', color: status === 'ready' ? T.green : status === 'error' ? T.hp : T.textDim }}>
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
                    fontSize: '14px',
                    letterSpacing: '0.06em',
                    padding: '8px 0',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  {die.label}
                  {count > 0 && (
                    <span style={{ position: 'absolute', right: '4px', top: '2px', fontSize: '12px' }}>x{count}</span>
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
              fontSize: '15px',
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
                  fontSize: '12px',
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
            <span style={{ fontSize: '14px', color: T.textMuted }}>{pending.length ? summarise(pending) : '\u00A0'}</span>
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
                fontSize: '13px',
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
                fontSize: '13px',
                letterSpacing: '0.1em',
              }}
            >
              {rolling ? 'ROLLING...' : 'ROLL'}
            </button>
          </div>

          {errorMsg && <div style={{ fontSize: '12px', color: T.hp }}>{errorMsg}</div>}
        </div>
      )}
      </>
      )}
    </>,
    document.body,
  );
}
