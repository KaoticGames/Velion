import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/store/authStore';
import { buildDiceBreakdown, type AdvantageKeep } from '@/lib/diceBreakdown';
import { rollDiceLocal } from '@/lib/localDiceRoll';
import { parseDiceFromFormula, summariseDiceNotation } from '@/lib/diceFormula';
import { useDiceOverlayController } from '@/dice/DiceOverlay';
import { commitDiceLogFromPayload, diceResultToLogKey } from '@/dice/diceLog';
import { sidesToDieType, type DiceAnimationFace, type DieType as AnimDieType } from '@/dice/types';
import { getDiceViewportAspect } from '@/dice/diceSpawn';
import { CANONICAL_DICE_VIEWPORT_ASPECT } from '@/lib/diceConstants';
import type { DiceResult } from '@/vtt/types';

/** After animation completes, keep the dice canvas visible before clearing. */
const LOCAL_ROLL_SCENE_HOLD_MS = 2000;

type DiceVisibility = 'public' | 'private' | 'dm';
type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

type RollContext = {
  modifier?: number;
  postMultiplier?: number;
  advantageKeep?: AdvantageKeep;
  forcedLabel?: string;
  source_label?: string;
  formula?: string;
  visibility?: DiceVisibility;
  physics_notation?: string;
  roll_id?: string;
  animation_spec?: DiceAnimationFace[];
  requestMeta?: Record<string, unknown>;
  remoteReplay?: boolean;
  authorityAwaitDiceComplete?: boolean;
  /** Server Rapier seed — clients mirror physics; never re-roll locally. */
  seed?: number;
  /** Die types in roll order — needed by playRollSeeded. */
  dieTypes?: AnimDieType[];
  /** Arena aspect from server sim — must match exactly on every client. */
  physicsViewportAspect?: number;
  /** When true, animation is cosmetic replay only; log/UI use server `dice:result`. */
  serverMirror?: boolean;
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

function summarise(dice: DiceType[]): string {
  return summariseDiceNotation(dice);
}

function isCharacterSheetPagePath(pathname: string): boolean {
  return /^\/characters\/(?!new$)[^/]+$/.test(pathname);
}

function isImmersiveDiceRoute(pathname: string): boolean {
  return pathname.startsWith('/vtt/') || pathname === '/characters/new';
}

function isDiceRollRoute(pathname: string): boolean {
  return pathname.startsWith('/vtt/')
    || pathname === '/characters/new'
    || /^\/characters\/[^/]+$/.test(pathname);
}

export default function GlobalDiceOverlay() {
  const user = useAuthStore((s) => s.user);
  const diceController = useDiceOverlayController();
  const diceControllerRef = useRef(diceController);
  diceControllerRef.current = diceController;

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<DiceType[]>([]);
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
  const physicsDiceActive = immersiveDiceActive || characterSheetLogOnly;
  const [diceSceneActive, setDiceSceneActive] = useState(false);
  const diceSceneActiveRef = useRef(false);
  const diceReadyOnceRef = useRef(false);

  const diceSceneTimerRef = useRef<number | null>(null);
  const activePhysicsRollIdRef = useRef<string | null>(null);
  const physicsSourceRollIdsRef = useRef<Set<string>>(new Set());
  const pendingAuthorityRollsRef = useRef<Map<string, { requestMeta?: Record<string, unknown> }>>(new Map());
  const remoteReplayRollIdsRef = useRef<Set<string>>(new Set());
  const committedDiceLogIdsRef = useRef<Set<string>>(new Set());
  const authoritySyncRef = useRef(new Map<string, {
    resultEntry?: DiceResult;
    requestMeta?: Record<string, unknown>;
    animationComplete: boolean;
  }>());
  const pendingRemoteSpecRef = useRef(new Map<string, {
    physics_notation?: string;
    label?: string;
    source_label?: string;
  }>());
  /** Rolls currently playing or awaiting animation — blocks socket handlers from killing the scene early. */
  const animatingRollIdsRef = useRef<Set<string>>(new Set());

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
  const physicsDiceActiveRef = useRef(physicsDiceActive);
  rollingRef.current = rolling;
  statusRef.current = status;
  diceRollActiveRef.current = diceRollActive;
  physicsDiceActiveRef.current = physicsDiceActive;
  diceSceneActiveRef.current = diceSceneActive;

  const clearDiceSceneTimer = () => {
    if (diceSceneTimerRef.current != null) {
      window.clearTimeout(diceSceneTimerRef.current);
      diceSceneTimerRef.current = null;
    }
  };

  const hideFullScreenDiceScene = () => {
    diceControllerRef.current.clear();
    setDiceSceneActive(false);
  };

  const scheduleHideScene = (ms = LOCAL_ROLL_SCENE_HOLD_MS) => {
    clearDiceSceneTimer();
    diceSceneTimerRef.current = window.setTimeout(() => {
      diceSceneTimerRef.current = null;
      hideFullScreenDiceScene();
    }, ms);
  };

  const commitDiceLogEntry = (entry: DiceResult) => {
    const key = diceResultToLogKey(entry);
    if (committedDiceLogIdsRef.current.has(key)) return;
    committedDiceLogIdsRef.current.add(key);
    if (committedDiceLogIdsRef.current.size > 200) {
      committedDiceLogIdsRef.current.clear();
    }
    commitDiceLogFromPayload(entry);
  };

  const tryDispatchAuthorityComplete = (rollId: string) => {
    const sync = authoritySyncRef.current.get(rollId);
    if (!sync?.resultEntry || !sync.animationComplete) return;
    authoritySyncRef.current.delete(rollId);
    window.dispatchEvent(new CustomEvent('velion:dice-roll-complete', {
      detail: {
        ...sync.resultEntry,
        requestMeta: sync.resultEntry.request_meta ?? sync.requestMeta,
      },
    }));
    scheduleHideScene();
  };

  const releaseAnimatingRoll = (rollId?: string) => {
    if (rollId) animatingRollIdsRef.current.delete(rollId);
  };

  const dispatchLocalRollPayload = useCallback((context: RollContext) => {
    if (!context.animation_spec?.length || !context.roll_id) return;

    const faces = context.animation_spec.map((f) => f.value);
    const breakdown = buildDiceBreakdown({
      faces,
      modifier: context.modifier,
      postMultiplier: context.postMultiplier,
      advantageKeep: context.advantageKeep,
    });

    physicsSourceRollIdsRef.current.add(context.roll_id);
    activePhysicsRollIdRef.current = null;

    const payload = {
      formula: context.formula || breakdown.formula,
      label: context.forcedLabel || labelRef.current || 'Dice Roll',
      visibility: visibilityRef.current,
      results: breakdown.results,
      total: breakdown.total,
      source_label: context.source_label ?? user?.email ?? 'Player',
      requestMeta: context.requestMeta,
      animation_spec: context.animation_spec,
      physics_notation: context.physics_notation,
      roll_id: context.roll_id,
      // Seed + die_types let receiving clients replay the identical visual simulation
      seed: context.seed,
      die_types: context.dieTypes?.map(String),
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
  }, [user?.email, user?.id]);

  const finishAnimationContextFor = useCallback((context: RollContext) => {
    setRolling(false);
    setPending([]);

    rollContextRef.current = {};
    releaseAnimatingRoll(context.roll_id);

    if (context.authorityAwaitDiceComplete && context.roll_id) {
      const rollId = context.roll_id;
      const prev = authoritySyncRef.current.get(rollId);
      authoritySyncRef.current.set(rollId, {
        resultEntry: prev?.resultEntry,
        requestMeta: prev?.requestMeta,
        animationComplete: true,
      });
      tryDispatchAuthorityComplete(rollId);
      activePhysicsRollIdRef.current = null;
      return;
    }

    if (context.remoteReplay || context.serverMirror) {
      activePhysicsRollIdRef.current = null;
      scheduleHideScene(context.remoteReplay ? LOCAL_ROLL_SCENE_HOLD_MS * 2 : LOCAL_ROLL_SCENE_HOLD_MS);
      return;
    }

    if (!context.animation_spec?.length || !context.roll_id) {
      activePhysicsRollIdRef.current = null;
      scheduleHideScene();
      return;
    }

    dispatchLocalRollPayload(context);
    scheduleHideScene();
  }, [dispatchLocalRollPayload]);

  const playAnimationSpec = useCallback(async (
    spec: DiceAnimationFace[],
    context: RollContext,
  ): Promise<boolean> => {
    if (!spec.length) return false;
    if (context.roll_id) animatingRollIdsRef.current.add(context.roll_id);
    rollContextRef.current = context;
    setRolling(true);
    setDiceSceneActive(true);
    clearDiceSceneTimer();

    try {
      const host = document.getElementById('global-dice-canvas-host');
      if (host) diceControllerRef.current.bindHost(host);
      await diceControllerRef.current.ensureReady();
      setStatus('ready');

      const contextSnapshot = context;
      let started: boolean;
      if (context.seed !== undefined && context.dieTypes?.length) {
        started = await diceControllerRef.current.playRollSeeded(
          context.seed,
          context.dieTypes,
          () => {
            finishAnimationContextFor(contextSnapshot);
          },
          context.physicsViewportAspect ?? CANONICAL_DICE_VIEWPORT_ASPECT,
        );
      } else {
        started = await diceControllerRef.current.playRoll(spec, () => {
          finishAnimationContextFor(contextSnapshot);
        });
      }
      if (!started) {
        const failedContext = { ...contextSnapshot };
        rollContextRef.current = {};
        releaseAnimatingRoll(context.roll_id);
        setRolling(false);
        setDiceSceneActive(false);
        if (!failedContext.authorityAwaitDiceComplete && !failedContext.remoteReplay) {
          dispatchLocalRollPayload(failedContext);
        }
      }
      return started;
    } catch (err: unknown) {
      releaseAnimatingRoll(context.roll_id);
      rollContextRef.current = {};
      setRolling(false);
      setDiceSceneActive(false);
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [finishAnimationContextFor, dispatchLocalRollPayload]);

  useEffect(() => {
    const syncPath = () => {
      const path = window.location.pathname;
      const nextRoll = isDiceRollRoute(path);
      const nextImmersive = isImmersiveDiceRoute(path);
      const nextSheet = isCharacterSheetPagePath(path);
      setDiceRollActive((prev) => (prev === nextRoll ? prev : nextRoll));
      setImmersiveDiceActive((prev) => (prev === nextImmersive ? prev : nextImmersive));
      setCharacterSheetLogOnly((prev) => (prev === nextSheet ? prev : nextSheet));
    };

    syncPath();
    window.addEventListener('popstate', syncPath);
    window.addEventListener('velion:route-change', syncPath as EventListener);

    const { pushState } = history;
    const { replaceState } = history;
    const wrap =
      (original: typeof history.pushState) =>
      (...args: Parameters<typeof history.pushState>) => {
        const result = original.apply(history, args);
        syncPath();
        return result;
      };
    history.pushState = wrap(pushState);
    history.replaceState = wrap(replaceState);

    return () => {
      window.removeEventListener('popstate', syncPath);
      window.removeEventListener('velion:route-change', syncPath as EventListener);
      history.pushState = pushState;
      history.replaceState = replaceState;
    };
  }, []);

  useEffect(() => {
    const onDiceResultPending = (event: Event) => {
      const entry = (event as CustomEvent<DiceResult>).detail;
      if (!entry) return;

      commitDiceLogEntry(entry);

      if (!diceRollActiveRef.current) return;

      if (entry.roll_id && animatingRollIdsRef.current.has(entry.roll_id)) {
        const pendingAuthorityRoll = pendingAuthorityRollsRef.current.get(entry.roll_id);
        const isAuthority = Boolean(pendingAuthorityRoll);

        if (
          entry.animation_spec?.length &&
          typeof entry.seed === 'number' &&
          entry.die_types?.length &&
          !rollingRef.current &&
          statusRef.current === 'ready' &&
          physicsDiceActiveRef.current
        ) {
          void playAnimationSpec(entry.animation_spec, {
            roll_id: entry.roll_id,
            physics_notation: entry.physics_notation,
            forcedLabel: entry.label,
            source_label: entry.source_label ?? undefined,
            remoteReplay: !isAuthority,
            authorityAwaitDiceComplete: isAuthority,
            serverMirror: true,
            seed: entry.seed,
            dieTypes: entry.die_types as AnimDieType[],
            physicsViewportAspect: entry.viewport_aspect ?? CANONICAL_DICE_VIEWPORT_ASPECT,
          });
        }

        if (pendingAuthorityRoll) {
          pendingAuthorityRollsRef.current.delete(entry.roll_id);
          const prev = authoritySyncRef.current.get(entry.roll_id);
          authoritySyncRef.current.set(entry.roll_id, {
            resultEntry: entry,
            requestMeta: pendingAuthorityRoll.requestMeta,
            animationComplete: prev?.animationComplete ?? false,
          });
          tryDispatchAuthorityComplete(entry.roll_id);
        }
        return;
      }

      const pendingAuthorityRoll = entry.roll_id ? pendingAuthorityRollsRef.current.get(entry.roll_id) : undefined;
      if (entry.roll_id && pendingAuthorityRoll) {
        pendingAuthorityRollsRef.current.delete(entry.roll_id);
        const prev = authoritySyncRef.current.get(entry.roll_id);
        authoritySyncRef.current.set(entry.roll_id, {
          resultEntry: entry,
          requestMeta: pendingAuthorityRoll.requestMeta,
          animationComplete: prev?.animationComplete ?? false,
        });
        setRolling(false);
        setPending([]);
        tryDispatchAuthorityComplete(entry.roll_id);
        return;
      }

      if (entry.roll_id && authoritySyncRef.current.has(entry.roll_id)) {
        return;
      }

      const isOwnPhysics = entry.roll_id && physicsSourceRollIdsRef.current.has(entry.roll_id);
      if (isOwnPhysics) return;

      if (entry.roll_id && remoteReplayRollIdsRef.current.has(entry.roll_id)) {
        remoteReplayRollIdsRef.current.delete(entry.roll_id);
        return;
      }

      if (
        entry.roll_id &&
        entry.animation_spec?.length &&
        typeof entry.seed === 'number' &&
        entry.die_types?.length &&
        physicsDiceActiveRef.current &&
        statusRef.current === 'ready' &&
        !rollingRef.current
      ) {
        const queued = pendingRemoteSpecRef.current.get(entry.roll_id);
        if (queued) pendingRemoteSpecRef.current.delete(entry.roll_id);
        remoteReplayRollIdsRef.current.add(entry.roll_id);
        void playAnimationSpec(entry.animation_spec, {
          roll_id: entry.roll_id,
          physics_notation: entry.physics_notation ?? queued?.physics_notation,
          forcedLabel: entry.label ?? queued?.label,
          source_label: entry.source_label ?? queued?.source_label ?? undefined,
          remoteReplay: true,
          serverMirror: true,
          seed: entry.seed,
          dieTypes: entry.die_types as AnimDieType[],
          physicsViewportAspect: entry.viewport_aspect ?? CANONICAL_DICE_VIEWPORT_ASPECT,
        });
        return;
      }
    };
    window.addEventListener('velion:dice-result-pending', onDiceResultPending as EventListener);
    return () => {
      window.removeEventListener('velion:dice-result-pending', onDiceResultPending as EventListener);
    };
  }, [playAnimationSpec, dispatchLocalRollPayload]);

  useEffect(() => {
    const ctrl = diceControllerRef.current;

    if (!diceRollActive) {
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      setStatus('loading');
      diceReadyOnceRef.current = false;
      ctrl.dispose();
      return;
    }
    if (!physicsDiceActive) {
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      diceReadyOnceRef.current = false;
      ctrl.dispose();
      setStatus('ready');
      return;
    }

    let cancelled = false;
    const host = document.getElementById('global-dice-canvas-host');
    if (host) ctrl.bindHost(host);

    void ctrl
      .ensureReady()
      .then(() => {
        if (!cancelled) {
          setStatus('ready');
          diceReadyOnceRef.current = true;
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      });

    const onResize = () => {
      const resizeHost = document.getElementById('global-dice-canvas-host');
      if (resizeHost) diceControllerRef.current.bindHost(resizeHost);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      setRolling(false);
      setDiceSceneActive(false);
      clearDiceSceneTimer();
      setStatus('loading');
      diceReadyOnceRef.current = false;
      ctrl.dispose();
    };
  }, [diceRollActive, physicsDiceActive]);

  const canRoll = useMemo(() => pending.length > 0 && !rolling && status === 'ready', [pending.length, rolling, status]);

  const requestServerAuthoritativeRoll = (
    dice: DiceType[],
    context: RollContext,
    rollId: string,
    physicsNot: string,
  ) => {
    const visibilityOut = context.visibility ?? visibilityRef.current;
    const labelOut = context.forcedLabel || labelRef.current || 'Dice Roll';
    const event = new CustomEvent('velion:dice-roll-authority-request', {
      cancelable: true,
      detail: {
        authority: 'server',
        roll_id: rollId,
        formula: context.formula || physicsNot,
        label: labelOut,
        visibility: visibilityOut,
        source_label: context.source_label ?? user?.email ?? 'Player',
        modifier: context.modifier,
        postMultiplier: context.postMultiplier,
        advantageKeep: context.advantageKeep,
        request_meta: context.requestMeta,
      },
    });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) return false;

    pendingAuthorityRollsRef.current.set(rollId, { requestMeta: context.requestMeta });
    animatingRollIdsRef.current.add(rollId);
    activePhysicsRollIdRef.current = null;
    rollContextRef.current = {};
    clearDiceSceneTimer();
    setPending(dice);
    return true;
  };

  const startPhysicalRoll = async (dice: DiceType[], context: RollContext = {}): Promise<boolean> => {
    if (!dice.length || rolling || status !== 'ready') return false;

    const rollId =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const physicsNot = summarise(dice);

    if (requestServerAuthoritativeRoll(dice, context, rollId, physicsNot)) return true;

    try {
      const physicsViewportAspect = getDiceViewportAspect();
      const rolled = await rollDiceLocal({
        diceExpr: context.formula || physicsNot,
        modifier: context.modifier,
        postMultiplier: context.postMultiplier,
        advantageKeep: context.advantageKeep,
        viewportAspect: physicsViewportAspect,
      });

      activePhysicsRollIdRef.current = rollId;
      animatingRollIdsRef.current.add(rollId);
      const breakdown = buildDiceBreakdown({
        faces: rolled.results,
        modifier: context.modifier,
        postMultiplier: context.postMultiplier,
        advantageKeep: context.advantageKeep,
      });

      const dieTypes = rolled.animation_spec.map(
        (f) => (sidesToDieType(f.sides) ?? 'd20') as AnimDieType,
      );

      const animContext: RollContext = {
        ...context,
        roll_id: rollId,
        physics_notation: physicsNot,
        animation_spec: rolled.animation_spec,
        formula: rolled.formula || breakdown.formula,
        forcedLabel: context.forcedLabel || labelRef.current || 'Dice Roll',
        seed: rolled.seed,
        dieTypes,
        physicsViewportAspect,
      };

      void playAnimationSpec(rolled.animation_spec, animContext);

      setPending(dice);
      return true;
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  const startDeterministicPhysicalRoll = (payload: {
    roll_id?: string;
    physics_notation?: string;
    animation_spec?: DiceAnimationFace[];
    label?: string;
    source_label?: string;
    seed?: number;
    die_types?: string[];
    viewport_aspect?: number;
  }): boolean => {
    if (!payload.roll_id || !payload.animation_spec?.length) return false;
    if (typeof payload.seed !== 'number' || !payload.die_types?.length) return false;
    if (statusRef.current !== 'ready') return false;
    if (activePhysicsRollIdRef.current === payload.roll_id) return false;
    if (physicsSourceRollIdsRef.current.has(payload.roll_id)) return false;

    const isAuthorityRoller = pendingAuthorityRollsRef.current.has(payload.roll_id);
    if (rollingRef.current && !isAuthorityRoller) return false;
    if (remoteReplayRollIdsRef.current.has(payload.roll_id) && !isAuthorityRoller) return false;

    if (!isAuthorityRoller) {
      remoteReplayRollIdsRef.current.add(payload.roll_id);
    }

    const seedDieTypes = payload.die_types as AnimDieType[];
    void playAnimationSpec(payload.animation_spec, {
      roll_id: payload.roll_id,
      physics_notation: payload.physics_notation,
      forcedLabel: payload.label,
      source_label: payload.source_label,
      remoteReplay: !isAuthorityRoller,
      authorityAwaitDiceComplete: isAuthorityRoller,
      serverMirror: true,
      seed: payload.seed,
      dieTypes: seedDieTypes,
      physicsViewportAspect: payload.viewport_aspect ?? CANONICAL_DICE_VIEWPORT_ASPECT,
    });

    return true;
  };

  const startRemotePhysicalRoll = (payload: {
    roll_id?: string;
    physics_notation?: string;
    label?: string;
    source_label?: string;
  }) => {
    if (statusRef.current !== 'ready') return false;
    if (!payload.roll_id || !payload.physics_notation) return false;
    if (activePhysicsRollIdRef.current === payload.roll_id) return false;
    if (physicsSourceRollIdsRef.current.has(payload.roll_id)) return false;
    if (remoteReplayRollIdsRef.current.has(payload.roll_id)) return false;
    if (rollingRef.current) return false;

    remoteReplayRollIdsRef.current.add(payload.roll_id);
    pendingRemoteSpecRef.current.set(payload.roll_id, {
      physics_notation: payload.physics_notation,
      label: payload.label,
      source_label: payload.source_label,
    });
    return true;
  };

  useEffect(() => {
    const onSessionDiceRollStart = (event: Event) => {
      const payload = (event as CustomEvent<{
        roll_id?: string;
        physics_notation?: string;
        animation_spec?: DiceAnimationFace[];
        label?: string;
        source_label?: string;
        seed?: number;
        die_types?: string[];
        viewport_aspect?: number;
      }>).detail;
      if (!payload || !diceRollActiveRef.current || !physicsDiceActiveRef.current) return;
      if (payload.roll_id && activePhysicsRollIdRef.current === payload.roll_id) return;

      const run = () => {
        if (statusRef.current !== 'ready') return;
        if (payload.animation_spec?.length) {
          startDeterministicPhysicalRoll(payload);
          return;
        }
        startRemotePhysicalRoll(payload);
      };

      if (statusRef.current === 'ready') {
        run();
        return;
      }
      const host = document.getElementById('global-dice-canvas-host');
      if (host) diceControllerRef.current.bindHost(host);
      void diceControllerRef.current.ensureReady().then(() => {
        if (statusRef.current === 'ready') run();
      });
    };
    window.addEventListener('velion:session-dice-roll-start', onSessionDiceRollStart as EventListener);
    return () => window.removeEventListener('velion:session-dice-roll-start', onSessionDiceRollStart as EventListener);
  }, []);

  const roll = () => {
    if (!canRoll) return;
    void startPhysicalRoll(pending, {
      forcedLabel: labelRef.current || undefined,
      source_label: user?.email ?? 'Player',
    }).then((started) => {
      if (started) setOpen(false);
    });
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
    const diceToRoll = parsed.length ? parsed : (['d20'] as DiceType[]);

    void startPhysicalRoll(diceToRoll, {
      formula: queuedExternalRoll.formula,
      modifier: queuedExternalRoll.modifier,
      postMultiplier: queuedExternalRoll.postMultiplier,
      advantageKeep: queuedExternalRoll.advantageKeep,
      forcedLabel: queuedExternalRoll.label,
      visibility: queuedExternalRoll.visibility,
      source_label: queuedExternalRoll.source_label,
      requestMeta: queuedExternalRoll.requestMeta,
    }).then((started) => {
      if (started) {
        setLabel(queuedExternalRoll.label ?? '');
        if (queuedExternalRoll.visibility) setVisibility(queuedExternalRoll.visibility);
        setQueuedExternalRoll(null);
      }
    });
  }, [queuedExternalRoll, status, rolling, diceRollActive]);

  if (!diceRollActive) return null;

  return createPortal(
    <>
      <DiceCanvasHost diceSceneActive={diceSceneActive} />

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
        ðŸŽ²
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
                diceControllerRef.current.clear();
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

function DiceCanvasHost({ diceSceneActive }: { diceSceneActive: boolean }) {
  return (
    <div
      id="global-dice-canvas-host"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 24000,
        opacity: diceSceneActive ? 1 : 0,
        transition: 'opacity 0.18s ease',
        pointerEvents: 'none',
      }}
    />
  );
}