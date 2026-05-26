import type { DiceResult } from '@/vtt/types';

/** Dice log entries are sourced from the server `dice:result` payload (Rapier physics on the backend). */
export function diceResultToLogKey(entry: DiceResult): string {
  return (
    entry.roll_id?.trim() ||
    `${entry.roller_id}\0${entry.formula}\0${entry.total}\0${JSON.stringify(entry.results)}`
  );
}

export function commitDiceLogFromPayload(entry: DiceResult): void {
  window.dispatchEvent(new CustomEvent('velion:dice-log-commit', { detail: entry }));
}
