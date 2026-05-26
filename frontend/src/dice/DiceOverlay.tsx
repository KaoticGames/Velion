import { useEffect, useRef } from 'react';
import { DiceSceneController } from './diceAnimator';
import { preloadAllDice } from './diceLoader';
import type { DiceAnimationFace, DieType } from './types';

export type DiceOverlayStatus = 'loading' | 'ready' | 'error';

export type DiceOverlayController = {
  bindHost: (el: HTMLElement | null) => void;
  ensureReady: () => Promise<boolean>;
  playRoll: (spec: DiceAnimationFace[], onComplete?: () => void, seed?: number) => Promise<boolean>;
  playRollSeeded: (
    seed: number,
    dieTypes: DieType[],
    onComplete?: (results: DiceAnimationFace[]) => void,
    physicsViewportAspect?: number,
  ) => Promise<boolean>;
  clear: () => void;
  dispose: () => void;
  getStatus: () => DiceOverlayStatus;
  setStatus: (s: DiceOverlayStatus) => void;
};

type DiceOverlayProps = {
  hostId?: string;
  active: boolean;
  onStatusChange?: (status: DiceOverlayStatus, error?: string) => void;
  onRollAnimationComplete?: () => void;
};

/** Stable controller instance — safe to omit from React effect dependency arrays. */
export function useDiceOverlayController(): DiceOverlayController {
  const controllerRef = useRef<DiceSceneController | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const statusRef = useRef<DiceOverlayStatus>('loading');
  const apiRef = useRef<DiceOverlayController | null>(null);

  if (!apiRef.current) {
    apiRef.current = {
      bindHost(el: HTMLElement | null) {
        hostRef.current = el;
      },

      async ensureReady(): Promise<boolean> {
        if (statusRef.current === 'ready' && controllerRef.current) return true;
        try {
          await preloadAllDice();
          if (!hostRef.current) return false;
          if (!controllerRef.current) {
            controllerRef.current = new DiceSceneController();
            await controllerRef.current.mount(hostRef.current);
          }
          statusRef.current = 'ready';
          return true;
        } catch (err: unknown) {
          statusRef.current = 'error';
          throw err;
        }
      },

      async playRoll(spec: DiceAnimationFace[], onComplete?: () => void): Promise<boolean> {
        const ready = await apiRef.current!.ensureReady();
        if (!ready || !controllerRef.current) return false;
        return await controllerRef.current.playRoll(spec, () => {
          onComplete?.();
        });
      },

      async playRollSeeded(
        seed: number,
        dieTypes: DieType[],
        onComplete?: (results: DiceAnimationFace[]) => void,
        physicsViewportAspect?: number,
      ): Promise<boolean> {
        const ready = await apiRef.current!.ensureReady();
        if (!ready || !controllerRef.current) return false;
        return await controllerRef.current.playRollSeeded(seed, dieTypes, (results) => {
          onComplete?.(results);
        }, physicsViewportAspect);
      },

      clear() {
        controllerRef.current?.clear();
      },

      dispose() {
        controllerRef.current?.dispose();
        controllerRef.current = null;
        statusRef.current = 'loading';
      },

      getStatus() {
        return statusRef.current;
      },

      setStatus(s: DiceOverlayStatus) {
        statusRef.current = s;
      },
    };
  }

  return apiRef.current;
}

/** Registers a DOM host element for the shared Three.js dice canvas. */
export default function DiceOverlay({
  hostId = 'global-dice-canvas-host',
  active,
  onStatusChange,
}: DiceOverlayProps) {
  const controller = useDiceOverlayController();

  useEffect(() => {
    if (!active) {
      controller.dispose();
      onStatusChange?.('loading');
      return;
    }

    const host = document.getElementById(hostId);
    if (!host) {
      onStatusChange?.('error', 'Dice canvas host not found');
      return;
    }

    controller.bindHost(host);
    let cancelled = false;

    controller
      .ensureReady()
      .then(() => {
        if (!cancelled) onStatusChange?.('ready');
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          onStatusChange?.('error', err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
      controller.dispose();
    };
  }, [active, hostId, controller, onStatusChange]);

  return null;
}