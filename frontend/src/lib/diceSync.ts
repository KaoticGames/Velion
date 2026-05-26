/**
 * diceSync.ts — Cross-tab dice synchronisation via BroadcastChannel.
 *
 * What gets broadcast: seed, die order, and viewport aspect — not the result.
 * Rapier arena bounds depend on aspect; all tabs must use the same aspect as
 * the rolling tab for identical physics. Receivers fall back to their own
 * aspect only for legacy messages missing `viewportAspect`.
 *
 * Each receiving tab runs the same seeded Rapier simulation (`playRollSeeded`).
 * The result is read from the rigid body when the die settles — never pre-selected.
 */

import type { DieType } from '@/dice/types';

const CHANNEL_NAME = 'velion-dice-sync';

/**
 * Coordination window: how far in the future the shared startAt is set.
 * Large enough for BroadcastChannel delivery + setTimeout scheduling;
 * small enough to be imperceptible on the sending tab.
 */
export const DICE_SYNC_WINDOW_MS = 100;

export type DiceSyncMessage = {
  type: 'DICE_ROLL_START';
  /** Matches roll_id in GlobalDiceOverlay for deduplication. */
  rollId: string;
  /**
   * The seed that drives the deterministic simulation on every tab.
   * Same seed → same physics → same result, without transmitting the result.
   */
  seed: number;
  /** Die types in roll order — needed for playRollSeeded on each tab. */
  dieTypes: DieType[];
  /** Viewport width/height used to build the Rapier arena — must match across tabs for identical physics. */
  viewportAspect: number;
  /**
   * Absolute Date.now() timestamp at which every tab starts animating.
   * Sender delays by DICE_SYNC_WINDOW_MS; receiver delays by (startAt - Date.now()).
   */
  startAt: number;
  label?: string;
  sourceLabel?: string;
};

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_channel) _channel = new BroadcastChannel(CHANNEL_NAME);
  return _channel;
}

/**
 * Broadcast a seeded dice roll to all other same-origin tabs.
 * Returns the shared startAt timestamp — the caller should delay its own
 * animation by (startAt - Date.now()) before calling playRollSeeded.
 */
export function broadcastDiceRoll(params: {
  rollId: string;
  seed: number;
  dieTypes: DieType[];
  viewportAspect: number;
  label?: string;
  sourceLabel?: string;
}): number {
  const startAt = Date.now() + DICE_SYNC_WINDOW_MS;
  const msg: DiceSyncMessage = {
    type: 'DICE_ROLL_START',
    rollId: params.rollId,
    seed: params.seed,
    dieTypes: params.dieTypes,
    viewportAspect: params.viewportAspect,
    startAt,
    label: params.label,
    sourceLabel: params.sourceLabel,
  };
  // BroadcastChannel does not deliver to the sender — caller handles own timing.
  getChannel()?.postMessage(msg);
  return startAt;
}

/**
 * Subscribe to seeded roll broadcasts from other tabs.
 * Returns an unsubscribe function for cleanup effects.
 *
 * @example
 * useEffect(() => {
 *   return onDiceSyncMessage(({ seed, dieTypes, startAt, rollId }) => {
 *     const delay = Math.max(0, startAt - Date.now());
 *     setTimeout(() => {
 *       diceController.playRollSeeded(seed, dieTypes, onComplete, viewportAspect);
 *     }, delay);
 *   });
 * }, []);
 */
export function onDiceSyncMessage(
  callback: (msg: DiceSyncMessage) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent<unknown>) => {
    const data = event.data as DiceSyncMessage;
    if (data?.type === 'DICE_ROLL_START') callback(data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}