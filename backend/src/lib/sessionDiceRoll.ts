/**
 * Session socket: server-authoritative dice (re-export from physics module).
 */

export {
  rollDiceAuthoritative,
  ensureServerDiceReady,
  type ServerDiceAuthorityInput,
  type ServerPhysicsRollResult,
  type AdvantageKeep,
} from '../dice/rollSessionDice';
