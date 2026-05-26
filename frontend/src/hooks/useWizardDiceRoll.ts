import { useCallback, useEffect, useRef, useState } from 'react';

export type WizardRollKind = 'attr3d20' | 'growth1d6' | 'growthNd6';

export type WizardRollResult = {
  rolls: number[];
  result: number;
};

type WizardRollRequestMeta = {
  wizardRoll: true;
  wizardRollKind: WizardRollKind;
  wizardRollDiceCount?: number;
};

type PendingRoll = {
  kind: WizardRollKind;
  diceCount: number;
  resolve: (value: WizardRollResult) => void;
  reject: (reason: Error) => void;
  timeoutId: number;
};

const ROLL_TIMEOUT_MS = 45_000;

function clampD6(v: number): number {
  return Math.max(1, Math.min(6, Math.floor(v)));
}

function parseCompleteDetail(
  detail: Record<string, unknown>,
  kind: WizardRollKind,
  diceCount: number,
): WizardRollResult {
  const spec = detail.animation_spec as Array<{ value: number }> | undefined;
  const faces = spec?.map((f) => f.value) ?? (detail.results as number[] | undefined) ?? [];

  if (kind === 'growth1d6') {
    const result = clampD6(faces[0] ?? 1);
    return { rolls: [result], result };
  }

  if (kind === 'growthNd6') {
    const rolls = faces.slice(0, diceCount).map(clampD6);
    while (rolls.length < diceCount) rolls.push(1);
    const result = rolls.reduce((s, v) => s + v, 0);
    return { rolls, result };
  }

  const rolls = faces.slice(0, 3);
  while (rolls.length < 3) rolls.push(1);
  const sum = rolls[0]! + rolls[1]! + rolls[2]!;
  return { rolls, result: Math.floor(sum / 3) };
}

export type WizardRollOptions = {
  /** Number of d6 for `growthNd6` (defaults to 1). */
  diceCount?: number;
};

/**
 * Queued physics rolls for character creation (step 2).
 * Dispatches `velion:dice-roll-request` and resolves on `velion:dice-roll-complete`.
 */
export function useWizardDiceRoll() {
  const [rolling, setRolling] = useState(false);
  const pendingRef = useRef<PendingRoll | null>(null);
  const queueRef = useRef<Array<() => void>>([]);
  const pumpingRef = useRef(false);

  const finishPending = useCallback((result: WizardRollResult) => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.timeoutId != null) window.clearTimeout(pending.timeoutId);
    pendingRef.current = null;
    pending.resolve(result);
    setRolling(false);
    pumpingRef.current = false;
    const next = queueRef.current.shift();
    if (next) next();
  }, []);

  const failPending = useCallback((message: string) => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (pending.timeoutId != null) window.clearTimeout(pending.timeoutId);
    pendingRef.current = null;
    pending.reject(new Error(message));
    setRolling(false);
    pumpingRef.current = false;
    const next = queueRef.current.shift();
    if (next) next();
  }, []);

  useEffect(() => {
    const onComplete = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail) return;
      const meta = detail.requestMeta as WizardRollRequestMeta | undefined;
      if (!meta?.wizardRoll || !pendingRef.current) return;
      if (meta.wizardRollKind !== pendingRef.current.kind) return;
      if (
        pendingRef.current.kind === 'growthNd6' &&
        meta.wizardRollDiceCount !== pendingRef.current.diceCount
      ) {
        return;
      }
      finishPending(parseCompleteDetail(detail, meta.wizardRollKind, pendingRef.current.diceCount));
    };

    window.addEventListener('velion:dice-roll-complete', onComplete as EventListener);
    return () => window.removeEventListener('velion:dice-roll-complete', onComplete as EventListener);
  }, [finishPending]);

  const requestRoll = useCallback(
    (kind: WizardRollKind, label: string, options?: WizardRollOptions): Promise<WizardRollResult> => {
      return new Promise((resolve, reject) => {
        const run = () => {
          if (pendingRef.current) {
            reject(new Error('Another wizard roll is in progress'));
            return;
          }

          const diceCount =
            kind === 'growthNd6' ? Math.max(1, Math.min(30, Math.floor(options?.diceCount ?? 1))) : 1;
          const formula =
            kind === 'attr3d20' ? '3d20' : kind === 'growth1d6' ? '1d6' : `${diceCount}d6`;

          setRolling(true);
          pumpingRef.current = true;

          const timeoutId = window.setTimeout(() => {
            failPending('Dice roll timed out — try again');
          }, ROLL_TIMEOUT_MS);

          pendingRef.current = {
            kind,
            diceCount,
            resolve,
            reject,
            timeoutId,
          };

          const requestMeta: WizardRollRequestMeta = {
            wizardRoll: true,
            wizardRollKind: kind,
            ...(kind === 'growthNd6' ? { wizardRollDiceCount: diceCount } : {}),
          };

          window.dispatchEvent(
            new CustomEvent('velion:dice-roll-request', {
              detail: {
                formula,
                label,
                visibility: 'private',
                autoOpen: false,
                requestMeta,
              },
            }),
          );
        };

        if (pumpingRef.current || pendingRef.current) {
          queueRef.current.push(run);
        } else {
          run();
        }
      });
    },
    [failPending],
  );

  return { requestRoll, rolling };
}
