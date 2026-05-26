import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api, { extractApiError } from '@/lib/api';
import { useWizardDiceRoll } from '@/hooks/useWizardDiceRoll';

const T = {
  bg: '#06070c',
  surface: '#0a0c14',
  card: '#0d1018',
  border: '#1c2030',
  gold: '#c4922a',
  goldDim: '#5a3e10',
  text: '#e4d8c0',
  textMuted: '#706858',
  textDim: '#282430',
  hp: '#e05050',
  success: '#3dba6a',
};

const ATTRS = ['Power', 'Agility', 'Focus', 'Presence'] as const;
type Attr = (typeof ATTRS)[number];
const ATTR_COLOR: Record<Attr, string> = {
  Power: '#e87050',
  Agility: '#50c878',
  Focus: '#7090e8',
  Presence: '#e8b050',
};

export type CreationBaseline = {
  power: number;
  agility: number;
  focus: number;
  presence: number;
  growth_roll: number;
  chosen_attribute: string;
};

export type LevelStep = {
  to_level: number;
  power_gain: number;
  agility_gain: number;
  focus_gain: number;
  presence_gain: number;
  growth_roll: number;
  chosen_attribute: string;
};

export type ProgressionSnapshot = {
  baseline: CreationBaseline;
  steps: LevelStep[];
  level: number;
  complete: boolean;
};

type FlowMode = 'set-level' | 'edit-origin' | 'audit';

type Phase =
  | 'loading'
  | 'pick'
  | 'bulk-up'
  | 'bulk-down'
  | 'audit'
  | 'origin'
  | 'done';

type Props = {
  open: boolean;
  mode: FlowMode;
  characterId: string;
  onClose: () => void;
  onApplied: (character: Record<string, unknown>) => void;
};

const Btn = (color: string, filled = false): React.CSSProperties => ({
  background: filled ? color : 'transparent',
  border: `1px solid ${color}`,
  color: filled ? '#06070c' : color,
  fontFamily: "'Cinzel', serif",
  fontSize: '13px',
  letterSpacing: '0.12em',
  padding: '9px 18px',
  borderRadius: '3px',
  cursor: 'pointer',
});

const LBL: React.CSSProperties = {
  fontFamily: "'Cinzel', serif",
  fontSize: '12px',
  letterSpacing: '0.14em',
  color: T.textMuted,
  display: 'block',
  marginBottom: '6px',
};

function cap(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : 'Power';
}

function missingLevels(snap: ProgressionSnapshot): number[] {
  const have = new Set(snap.steps.map((s) => s.to_level));
  const out: number[] = [];
  for (let lv = 2; lv <= snap.level; lv++) {
    if (!have.has(lv)) out.push(lv);
  }
  return out;
}

function missingLevelsInRange(snap: ProgressionSnapshot, target: number): number[] {
  const have = new Set(snap.steps.map((s) => s.to_level));
  const out: number[] = [];
  for (let lv = target + 1; lv <= snap.level; lv++) {
    if (!have.has(lv)) out.push(lv);
  }
  return out;
}

function stepsRemovedForTarget(snap: ProgressionSnapshot, target: number): LevelStep[] {
  return snap.steps
    .filter((s) => s.to_level > target && s.to_level <= snap.level)
    .sort((a, b) => a.to_level - b.to_level);
}

export default function LevelProgressionFlow({ open, mode, characterId, onClose, onApplied }: Props) {
  const [snap, setSnap] = useState<ProgressionSnapshot | null>(null);
  const [error, setError] = useState('');
  const [targetLevel, setTargetLevel] = useState(1);
  const [phase, setPhase] = useState<Phase>('loading');
  const [auditLevel, setAuditLevel] = useState(2);
  const [luDist, setLuDist] = useState<Record<Attr, number>>({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
  const [luTotal, setLuTotal] = useState(0);
  const [luGRoll, setLuGRoll] = useState<number | null>(null);
  const [luChosen, setLuChosen] = useState<Attr>('Power');
  const [origin, setOrigin] = useState<CreationBaseline | null>(null);

  const [bulkDist, setBulkDist] = useState<Record<Attr, number>>({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
  const [bulkChosen, setBulkChosen] = useState<Attr>('Power');
  const [bulkGrowthRolls, setBulkGrowthRolls] = useState<(number | null)[]>([]);
  const [bulkLevelDelta, setBulkLevelDelta] = useState(0);
  const [bulkTarget, setBulkTarget] = useState(1);

  const [bulkDownDist, setBulkDownDist] = useState<Record<Attr, number>>({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
  const [bulkDownCaps, setBulkDownCaps] = useState<Record<Attr, number>>({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
  const [bulkDownGrowthRolls, setBulkDownGrowthRolls] = useState<number[]>([]);

  const { requestRoll, rolling: diceRolling } = useWizardDiceRoll();

  const loadSnap = useCallback(async () => {
    const { data } = await api.get<ProgressionSnapshot>(`/characters/${characterId}/progression`);
    setSnap(data);
    setTargetLevel(data.level);
    setOrigin(data.baseline);
    return data;
  }, [characterId]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPhase('loading');
    loadSnap()
      .then((data) => {
        if (mode === 'edit-origin') {
          setPhase('origin');
          return;
        }
        if (mode === 'audit') {
          const miss = missingLevels(data);
          if (miss.length) {
            setAuditLevel(miss[0]!);
            resetLuForm(data.baseline.chosen_attribute);
            setPhase('audit');
            return;
          }
        }
        setPhase('pick');
      })
      .catch((e) => setError(extractApiError(e).message));
  }, [open, mode, loadSnap]);

  const refreshCharacter = useCallback(async () => {
    const { data } = await api.get(`/characters/${characterId}`);
    onApplied(data as Record<string, unknown>);
  }, [characterId, onApplied]);

  const bulkAttrBudget = bulkLevelDelta * 2;
  const bulkAttrTotal = useMemo(
    () => ATTRS.reduce((s, a) => s + bulkDist[a], 0),
    [bulkDist],
  );
  const bulkGrowthFilled = bulkGrowthRolls.filter((r) => r != null).length;
  const bulkGrowthRemaining = bulkGrowthRolls.filter((r) => r == null).length;

  const bulkDownAttrBudget = bulkLevelDelta * 2;
  const bulkDownAttrTotal = useMemo(
    () => ATTRS.reduce((s, a) => s + bulkDownDist[a], 0),
    [bulkDownDist],
  );
  const bulkDownRecordedTotal = useMemo(
    () => ATTRS.reduce((s, a) => s + bulkDownCaps[a], 0),
    [bulkDownCaps],
  );

  const resetLuForm = (chosen: string) => {
    setLuDist({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
    setLuTotal(0);
    setLuGRoll(null);
    setLuChosen(cap(chosen) as Attr);
  };

  const luAdd = (a: Attr) => {
    if (luDist[a] >= 1 || luTotal >= 2) return;
    setLuDist((p) => ({ ...p, [a]: p[a] + 1 }));
    setLuTotal((p) => p + 1);
  };
  const luSub = (a: Attr) => {
    if (luDist[a] <= 0) return;
    setLuDist((p) => ({ ...p, [a]: p[a] - 1 }));
    setLuTotal((p) => p - 1);
  };

  const bulkAdd = (a: Attr) => {
    if (bulkDist[a] >= bulkLevelDelta || bulkAttrTotal >= bulkAttrBudget) return;
    setBulkDist((p) => ({ ...p, [a]: p[a] + 1 }));
  };
  const bulkSub = (a: Attr) => {
    if (bulkDist[a] <= 0) return;
    setBulkDist((p) => ({ ...p, [a]: p[a] - 1 }));
  };

  const bulkDownAdd = (a: Attr) => {
    if (bulkDownDist[a] >= bulkDownCaps[a] || bulkDownAttrTotal >= bulkDownAttrBudget) return;
    setBulkDownDist((p) => ({ ...p, [a]: p[a] + 1 }));
  };
  const bulkDownSub = (a: Attr) => {
    if (bulkDownDist[a] <= 0) return;
    setBulkDownDist((p) => ({ ...p, [a]: p[a] - 1 }));
  };

  const initBulkUp = (data: ProgressionSnapshot, target: number) => {
    const delta = target - data.level;
    setBulkLevelDelta(delta);
    setBulkTarget(target);
    setBulkDist({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
    setBulkGrowthRolls(Array.from({ length: delta }, () => null));
    setBulkChosen(cap(data.steps[data.steps.length - 1]?.chosen_attribute ?? data.baseline.chosen_attribute) as Attr);
    setPhase('bulk-up');
  };

  const initBulkDown = (data: ProgressionSnapshot, target: number) => {
    const delta = data.level - target;
    const miss = missingLevelsInRange(data, target);
    if (miss.length) {
      setError(`Missing progression for level(s) ${miss.join(', ')} — record them before lowering level.`);
      setAuditLevel(miss[0]!);
      resetLuForm(data.baseline.chosen_attribute);
      setPhase('audit');
      return;
    }
    const removed = stepsRemovedForTarget(data, target);
    const caps: Record<Attr, number> = { Power: 0, Agility: 0, Focus: 0, Presence: 0 };
    for (const s of removed) {
      caps.Power += s.power_gain;
      caps.Agility += s.agility_gain;
      caps.Focus += s.focus_gain;
      caps.Presence += s.presence_gain;
    }
    setBulkLevelDelta(delta);
    setBulkTarget(target);
    setBulkDownCaps(caps);
    setBulkDownDist({ Power: 0, Agility: 0, Focus: 0, Presence: 0 });
    setBulkDownGrowthRolls(removed.map((s) => s.growth_roll));
    setError('');
    setPhase('bulk-down');
  };

  const applyAuditStep = async () => {
    if (luGRoll == null || luTotal !== 2) return;
    await api.put(`/characters/${characterId}/progression/step/${auditLevel}`, {
      power_gain: luDist.Power || 0,
      agility_gain: luDist.Agility || 0,
      focus_gain: luDist.Focus || 0,
      presence_gain: luDist.Presence || 0,
      growth_roll: luGRoll,
      chosen_attribute: luChosen.toLowerCase(),
    });
    return loadSnap();
  };

  const seqTargetRef = useRef<number | null>(null);

  const advanceSequence = useCallback(
    async (data: ProgressionSnapshot) => {
      const target = seqTargetRef.current;
      if (target == null) return;

      if (data.level > target) {
        initBulkDown(data, target);
        return;
      }

      if (data.level === target) {
        seqTargetRef.current = null;
        await refreshCharacter();
        setPhase('done');
        return;
      }

      initBulkUp(data, target);
    },
    [refreshCharacter],
  );

  const startSetLevel = async () => {
    if (!snap) return;
    const t = Math.max(1, Math.min(100, Math.floor(targetLevel)));
    setError('');
    if (t === snap.level) {
      setPhase('done');
      return;
    }
    seqTargetRef.current = t;
    if (t > snap.level) {
      initBulkUp(snap, t);
      return;
    }
    initBulkDown(snap, t);
  };

  const confirmAuditStep = async () => {
    try {
      const data = await applyAuditStep();
      if (!data) return;
      setSnap(data);
      const miss = missingLevels(data);
      if (miss.length) {
        setAuditLevel(miss[0]!);
        resetLuForm(data.baseline.chosen_attribute);
        return;
      }
      if (seqTargetRef.current != null) {
        await advanceSequence(data);
        return;
      }
      if (mode === 'set-level') {
        setPhase('pick');
        return;
      }
      await refreshCharacter();
      setPhase('done');
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const confirmBulkDown = async () => {
    if (!snap) return;
    if (bulkDownAttrTotal !== bulkDownAttrBudget) return;
    if (bulkDownAttrTotal !== bulkDownRecordedTotal) return;
    setError('');
    try {
      await api.post(`/characters/${characterId}/progression/bulk-down`, {
        target_level: bulkTarget,
        power: bulkDownDist.Power,
        agility: bulkDownDist.Agility,
        focus: bulkDownDist.Focus,
        presence: bulkDownDist.Presence,
      });
      seqTargetRef.current = null;
      await refreshCharacter();
      setPhase('done');
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const rollAuditGrowth = async () => {
    setError('');
    try {
      const { result } = await requestRoll('growth1d6', `Level ${auditLevel} — Growth Pool`);
      setLuGRoll(result);
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const rollNextBulkGrowth = async () => {
    const idx = bulkGrowthRolls.findIndex((r) => r == null);
    if (idx < 0) return;
    setError('');
    try {
      const fromLv = (snap?.level ?? 1) + idx + 1;
      const { result } = await requestRoll('growth1d6', `Level ${fromLv} — Growth Pool`);
      setBulkGrowthRolls((prev) => {
        const next = [...prev];
        next[idx] = result;
        return next;
      });
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const rollAllBulkGrowth = async () => {
    const remaining = bulkGrowthRolls.filter((r) => r == null).length;
    if (remaining <= 0) return;
    setError('');
    try {
      const { rolls } = await requestRoll('growthNd6', `Levels — Growth Pool ${remaining}d6`, {
        diceCount: remaining,
      });
      setBulkGrowthRolls((prev) => {
        const next = [...prev];
        let ri = 0;
        for (let i = 0; i < next.length; i++) {
          if (next[i] == null) {
            next[i] = rolls[ri] ?? 1;
            ri += 1;
          }
        }
        return next;
      });
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const confirmBulkUp = async () => {
    if (!snap) return;
    if (bulkAttrTotal !== bulkAttrBudget) return;
    if (bulkGrowthRolls.some((r) => r == null)) return;
    setError('');
    try {
      await api.post(`/characters/${characterId}/progression/bulk-up`, {
        target_level: bulkTarget,
        power: bulkDist.Power,
        agility: bulkDist.Agility,
        focus: bulkDist.Focus,
        presence: bulkDist.Presence,
        growth_rolls: bulkGrowthRolls as number[],
        chosen_attribute: bulkChosen.toLowerCase(),
      });
      seqTargetRef.current = null;
      await refreshCharacter();
      setPhase('done');
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const saveOrigin = async () => {
    if (!origin) return;
    try {
      await api.put(`/characters/${characterId}/creation-baseline`, {
        ...origin,
        chosen_attribute: origin.chosen_attribute.toLowerCase(),
      });
      await refreshCharacter();
      setPhase('done');
    } catch (e) {
      setError(extractApiError(e).message);
    }
  };

  const title = useMemo(() => {
    if (phase === 'origin') return 'EDIT ORIGIN (LEVEL 1)';
    if (phase === 'audit') return 'RECORD LEVEL PROGRESSION';
    if (phase === 'bulk-up') return 'LEVEL UP — ATTRIBUTE & GROWTH';
    if (phase === 'bulk-down') return 'LOWER LEVEL — ATTRIBUTE & GROWTH';
    if (phase === 'done') return 'COMPLETE';
    return 'SET CHARACTER LEVEL';
  }, [phase]);

  const bulkCanApply =
    bulkAttrTotal === bulkAttrBudget &&
    bulkGrowthFilled === bulkLevelDelta &&
    !diceRolling;

  const bulkDownCanApply =
    bulkDownAttrTotal === bulkDownAttrBudget &&
    bulkDownAttrTotal === bulkDownRecordedTotal &&
    ATTRS.every((a) => bulkDownDist[a] <= bulkDownCaps[a]);

  if (!open) return null;

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 999 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          top: '72px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '560px',
          padding: '0 16px',
          zIndex: 1000,
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            background: T.card,
            border: `1px solid ${T.gold}44`,
            borderTop: `2px solid ${T.gold}`,
            borderRadius: '4px',
            padding: '22px',
          }}
        >
          <div
            style={{
              fontFamily: "'Cinzel', serif",
              fontSize: '15px',
              letterSpacing: '0.2em',
              color: T.gold,
              marginBottom: '8px',
            }}
          >
            {title}
          </div>

          {phase === 'loading' && <p style={{ color: T.textMuted }}>Loading progression…</p>}

          {error && <p style={{ color: T.hp, marginBottom: '12px' }}>{error}</p>}

          {phase === 'pick' && snap && (
            <>
              <p style={{ color: T.textMuted, fontSize: '16px', lineHeight: 1.6, marginBottom: '16px' }}>
                Current level: <strong style={{ color: T.gold }}>{snap.level}</strong>. Choose a target level — going up
                or down consolidates attribute points; growth d6 for removed levels are dropped from right to left.
              </p>
              <label style={LBL}>TARGET LEVEL</label>
              <input
                type="number"
                min={1}
                max={100}
                value={targetLevel}
                onChange={(e) => setTargetLevel(Number(e.target.value) || 1)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  color: T.gold,
                  fontSize: '22px',
                  padding: '10px 14px',
                  borderRadius: '3px',
                  marginBottom: '18px',
                }}
              />
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="button" onClick={onClose} style={Btn(T.textMuted)}>
                  CANCEL
                </button>
                <button type="button" onClick={() => void startSetLevel()} style={{ ...Btn(T.gold, true), flex: 1 }}>
                  CONTINUE
                </button>
              </div>
            </>
          )}

          {phase === 'bulk-up' && snap && (
            <>
              <p style={{ color: T.textMuted, marginBottom: '14px', lineHeight: 1.55 }}>
                Level <strong style={{ color: T.gold }}>{snap.level}</strong> →{' '}
                <strong style={{ color: T.gold }}>{bulkTarget}</strong> ({bulkLevelDelta} level
                {bulkLevelDelta === 1 ? '' : 's'}): distribute{' '}
                <strong style={{ color: T.gold }}>{bulkAttrBudget}</strong> attribute points (max +1 per attribute per
                level) and roll <strong style={{ color: T.gold }}>{bulkLevelDelta}</strong> growth d6.
              </p>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={LBL}>ATTRIBUTE POINTS</span>
                  <span style={{ color: bulkAttrTotal === bulkAttrBudget ? T.success : T.textMuted }}>
                    {bulkAttrTotal}/{bulkAttrBudget}
                  </span>
                </div>
                {ATTRS.map((attr) => (
                  <div
                    key={attr}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '6px',
                      padding: '6px 10px',
                      background: T.surface,
                      borderRadius: '3px',
                    }}
                  >
                    <span
                      style={{
                        color: ATTR_COLOR[attr],
                        minWidth: '72px',
                        fontFamily: "'Cinzel', serif",
                        fontSize: '12px',
                      }}
                    >
                      {attr}
                    </span>
                    <button type="button" onClick={() => bulkSub(attr)} disabled={bulkDist[attr] <= 0} style={Btn(ATTR_COLOR[attr])}>
                      −
                    </button>
                    <span style={{ color: T.text, minWidth: '36px', textAlign: 'center' }}>+{bulkDist[attr]}</span>
                    <button
                      type="button"
                      onClick={() => bulkAdd(attr)}
                      disabled={bulkDist[attr] >= bulkLevelDelta || bulkAttrTotal >= bulkAttrBudget}
                      style={Btn(ATTR_COLOR[attr])}
                    >
                      +
                    </button>
                    <span style={{ color: T.textDim, fontSize: '11px' }}>max +{bulkLevelDelta}</span>
                  </div>
                ))}
              </div>

              <label style={LBL}>CHOSEN ATTRIBUTE</label>
              <select
                value={bulkChosen}
                onChange={(e) => setBulkChosen(e.target.value as Attr)}
                style={{
                  width: '100%',
                  marginBottom: '14px',
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  padding: '8px',
                }}
              >
                {ATTRS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>

              <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={LBL}>GROWTH POOL (d6 per level)</span>
                  <span style={{ color: bulkGrowthFilled === bulkLevelDelta ? T.success : T.textMuted }}>
                    {bulkGrowthFilled}/{bulkLevelDelta}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                  {bulkGrowthRolls.map((r, i) => (
                    <span
                      key={i}
                      title={`Level ${(snap?.level ?? 1) + i + 1}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '32px',
                        height: '32px',
                        borderRadius: '3px',
                        border: `1px solid ${r != null ? T.gold : T.border}`,
                        background: T.surface,
                        color: r != null ? T.gold : T.textDim,
                        fontWeight: 700,
                        fontSize: '14px',
                      }}
                    >
                      {r ?? '—'}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => void rollNextBulkGrowth()}
                    disabled={diceRolling || bulkGrowthRemaining <= 0}
                    style={{ ...Btn(T.gold, true), opacity: diceRolling || bulkGrowthRemaining <= 0 ? 0.5 : 1 }}
                  >
                    {diceRolling ? 'ROLLING…' : 'ROLL d6'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void rollAllBulkGrowth()}
                    disabled={diceRolling || bulkGrowthRemaining <= 0}
                    style={{ ...Btn(T.gold), opacity: diceRolling || bulkGrowthRemaining <= 0 ? 0.5 : 1 }}
                  >
                    ROLL ALL ({bulkGrowthRemaining}d6)
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    seqTargetRef.current = null;
                    setPhase('pick');
                  }}
                  style={Btn(T.textMuted)}
                >
                  BACK
                </button>
                <button
                  type="button"
                  onClick={() => void confirmBulkUp()}
                  disabled={!bulkCanApply}
                  style={{ ...Btn(T.gold, true), flex: 1, opacity: bulkCanApply ? 1 : 0.4 }}
                >
                  APPLY LEVEL {bulkTarget}
                </button>
              </div>
            </>
          )}

          {phase === 'audit' && snap && (
            <>
              <p style={{ color: T.textMuted, marginBottom: '14px', lineHeight: 1.55 }}>
                Record gains for reaching level {auditLevel}. Required before lowering level if history is incomplete.
              </p>
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={LBL}>ATTRIBUTE POINTS</span>
                  <span style={{ color: luTotal === 2 ? T.success : T.textMuted }}>{luTotal}/2</span>
                </div>
                {ATTRS.map((attr) => (
                  <div
                    key={attr}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '6px',
                      padding: '6px 10px',
                      background: T.surface,
                      borderRadius: '3px',
                    }}
                  >
                    <span
                      style={{
                        color: ATTR_COLOR[attr],
                        minWidth: '72px',
                        fontFamily: "'Cinzel', serif",
                        fontSize: '12px',
                      }}
                    >
                      {attr}
                    </span>
                    <button type="button" onClick={() => luSub(attr)} disabled={luDist[attr] <= 0} style={Btn(ATTR_COLOR[attr])}>
                      −
                    </button>
                    <span style={{ color: T.text }}>{luDist[attr] ? '+1' : '—'}</span>
                    <button
                      type="button"
                      onClick={() => luAdd(attr)}
                      disabled={luDist[attr] >= 1 || luTotal >= 2}
                      style={Btn(ATTR_COLOR[attr])}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
              <label style={LBL}>CHOSEN ATTRIBUTE</label>
              <select
                value={luChosen}
                onChange={(e) => setLuChosen(e.target.value as Attr)}
                style={{
                  width: '100%',
                  marginBottom: '14px',
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  padding: '8px',
                }}
              >
                {ATTRS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <button
                  type="button"
                  onClick={() => void rollAuditGrowth()}
                  disabled={diceRolling}
                  style={{ ...Btn(T.gold, true), opacity: diceRolling ? 0.5 : 1 }}
                >
                  {diceRolling ? 'ROLLING…' : `⬡ ROLL d6${luGRoll != null ? ' (reroll)' : ''}`}
                </button>
                {luGRoll != null && <span style={{ color: T.gold, fontSize: '24px', fontWeight: 700 }}>{luGRoll}</span>}
              </div>
              <button
                type="button"
                onClick={() => void confirmAuditStep()}
                disabled={luTotal !== 2 || luGRoll == null || diceRolling}
                style={{ ...Btn(T.gold, true), width: '100%', opacity: luTotal === 2 && luGRoll != null ? 1 : 0.4 }}
              >
                CONFIRM STEP
              </button>
            </>
          )}

          {phase === 'bulk-down' && snap && (
            <>
              <p style={{ color: T.textMuted, marginBottom: '14px', lineHeight: 1.55 }}>
                Level <strong style={{ color: T.gold }}>{snap.level}</strong> →{' '}
                <strong style={{ color: T.gold }}>{bulkTarget}</strong> ({bulkLevelDelta} level
                {bulkLevelDelta === 1 ? '' : 's'}): allocate{' '}
                <strong style={{ color: T.gold }}>{bulkDownAttrBudget}</strong> attribute points to remove (order does
                not matter). Growth pool rolls for removed levels are cleared from right to left.
              </p>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={LBL}>ATTRIBUTE POINTS TO REMOVE</span>
                  <span style={{ color: bulkDownAttrTotal === bulkDownAttrBudget ? T.success : T.textMuted }}>
                    {bulkDownAttrTotal}/{bulkDownAttrBudget}
                  </span>
                </div>
                {ATTRS.map((attr) => (
                  <div
                    key={attr}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      marginBottom: '6px',
                      padding: '6px 10px',
                      background: T.surface,
                      borderRadius: '3px',
                    }}
                  >
                    <span
                      style={{
                        color: ATTR_COLOR[attr],
                        minWidth: '72px',
                        fontFamily: "'Cinzel', serif",
                        fontSize: '12px',
                      }}
                    >
                      {attr}
                    </span>
                    <button
                      type="button"
                      onClick={() => bulkDownSub(attr)}
                      disabled={bulkDownDist[attr] <= 0}
                      style={Btn(ATTR_COLOR[attr])}
                    >
                      −
                    </button>
                    <span style={{ color: T.text, minWidth: '36px', textAlign: 'center' }}>−{bulkDownDist[attr]}</span>
                    <button
                      type="button"
                      onClick={() => bulkDownAdd(attr)}
                      disabled={
                        bulkDownDist[attr] >= bulkDownCaps[attr] || bulkDownAttrTotal >= bulkDownAttrBudget
                      }
                      style={Btn(ATTR_COLOR[attr])}
                    >
                      +
                    </button>
                    <span style={{ color: T.textDim, fontSize: '11px' }}>max −{bulkDownCaps[attr]}</span>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: '14px' }}>
                <span style={LBL}>GROWTH POOL REMOVED (right → left)</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {bulkDownGrowthRolls.map((r, i) => (
                    <span
                      key={i}
                      title={`Level ${(snap?.level ?? 1) - bulkDownGrowthRolls.length + i + 1} — removed`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minWidth: '32px',
                        height: '32px',
                        borderRadius: '3px',
                        border: `1px solid ${T.hp}`,
                        background: `${T.hp}22`,
                        color: T.hp,
                        fontWeight: 700,
                        fontSize: '14px',
                        textDecoration: 'line-through',
                      }}
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    seqTargetRef.current = null;
                    setPhase('pick');
                  }}
                  style={Btn(T.textMuted)}
                >
                  BACK
                </button>
                <button
                  type="button"
                  onClick={() => void confirmBulkDown()}
                  disabled={!bulkDownCanApply}
                  style={{ ...Btn(T.hp, true), flex: 1, opacity: bulkDownCanApply ? 1 : 0.4 }}
                >
                  APPLY LEVEL {bulkTarget}
                </button>
              </div>
            </>
          )}

          {phase === 'origin' && origin && (
            <>
              <p style={{ color: T.textMuted, marginBottom: '14px', lineHeight: 1.55 }}>
                Edit your level-1 origin (creation). Level-up history is kept; totals are recalculated from origin + all
                recorded levels.
              </p>
              {(['power', 'agility', 'focus', 'presence'] as const).map((key) => (
                <div key={key} style={{ marginBottom: '10px' }}>
                  <label style={LBL}>{key.toUpperCase()}</label>
                  <input
                    type="number"
                    value={origin[key]}
                    onChange={(e) => setOrigin((o) => (o ? { ...o, [key]: Number(e.target.value) || 10 } : o))}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      background: T.surface,
                      border: `1px solid ${T.border}`,
                      color: T.text,
                      padding: '8px',
                    }}
                  />
                </div>
              ))}
              <div style={{ marginBottom: '10px' }}>
                <label style={LBL}>GROWTH POOL (level 1 d6)</label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={origin.growth_roll}
                  onChange={(e) =>
                    setOrigin((o) =>
                      o ? { ...o, growth_roll: Math.max(1, Math.min(6, Number(e.target.value) || 1)) } : o,
                    )
                  }
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    color: T.gold,
                    padding: '8px',
                  }}
                />
              </div>
              <label style={LBL}>CHOSEN ATTRIBUTE</label>
              <select
                value={cap(origin.chosen_attribute)}
                onChange={(e) => setOrigin((o) => (o ? { ...o, chosen_attribute: e.target.value.toLowerCase() } : o))}
                style={{
                  width: '100%',
                  marginBottom: '16px',
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  color: T.text,
                  padding: '8px',
                }}
              >
                {ATTRS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => void saveOrigin()} style={{ ...Btn(T.gold, true), width: '100%' }}>
                SAVE ORIGIN
              </button>
            </>
          )}

          {phase === 'done' && (
            <>
              <p style={{ color: T.success, marginBottom: '16px' }}>Changes applied.</p>
              <button type="button" onClick={onClose} style={{ ...Btn(T.gold, true), width: '100%' }}>
                CLOSE
              </button>
            </>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
