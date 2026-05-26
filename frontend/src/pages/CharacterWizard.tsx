import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { extractApiError } from '@/lib/api';
import WizardEquipmentStep from '@/components/character-wizard/WizardEquipmentStep';
import { commitStartingEquipment, type StartingGearState } from '@/lib/startingEquipment';
import { useAuthStore } from '@/store/authStore';
import SpecialAbilitiesPanel from '@/components/special-abilities/SpecialAbilitiesPanel';
import { draftToPayload, type SpecialAbilityDraft } from '@/lib/specialAbilities';
import { useWizardDiceRoll } from '@/hooks/useWizardDiceRoll';

type AttrHelpKey = 'power' | 'agility' | 'focus' | 'presence';

type AttributeHelpEntry = {
  label: string;
  summary: string;
  bullets?: readonly string[];
  paragraphs: readonly string[];
};

/** Player-facing copy; gear thresholds match library / compendium (armor tiers, bracers, weapons with req_*). */
const ATTRIBUTE_HELP: Record<AttrHelpKey, AttributeHelpEntry> = {
  power: {
    label: 'Power',
    summary: 'Raw physical might and endurance—forcing your way through obstacles, wearing heavy kit, and winning contests of brute force.',
    bullets: [
      'Equipment: heavier armor and many two-handed or high-impact weapons list a Power requirement; higher Power keeps those options open as you upgrade.',
      'Play: breaking doors, grappling, resisting being pinned or dragged, and any check where you solve the problem by pushing harder.',
      'Examples: crowbars and similar tools boost Power when forcing things open; traps and restraints often set a Power DC to resist or break free.',
    ],
    paragraphs: [
      'When the table asks “can you physically overwhelm this?”—that is usually Power, not Agility.',
      'If you want a front-liner in plate or a striker who leans on big weapons, put one of your best rolls here.',
    ],
  },
  agility: {
    label: 'Agility',
    summary: 'Speed, balance, and precision—dodging, sneaking, climbing, and landing finesse or ranged strikes.',
    bullets: [
      'Equipment: light weapons, bows, rapiers, and other finesse or ranged lines often need Agility; plan ahead if you want that fighting style.',
      'Play: initiative-like moments, slipping past guards, tumbling, fine manipulation, and attacks that rely on placement over muscle.',
      'Examples: climbing ropes, picking locks (often with tools), and any check where you solve the problem by moving cleanly.',
    ],
    paragraphs: [
      'Agility is how you stay untouched and how you connect when the fiction is about timing and lines, not raw lift.',
      'Duelists, scouts, and sharpshooters typically want Agility high; pair it with enough Power or Focus for the armor or magic you still want to wear.',
    ],
  },
  focus: {
    label: 'Focus',
    summary: 'Mental clarity and arcane bandwidth—perception, medicine, investigation, and binding power through Focus Bracers and spell gems.',
    bullets: [
      'Equipment: channeling weapons and advanced spell gems demand Focus; bracer tiers scale with it (e.g. more gem slots on higher-Focus bracers—see compendium).',
      'Play: noticing ambushes, reading situations under stress, stabilizing allies, and any check where calm attention beats muscle.',
      'Spell gems: once slotted, gems use their own rules in combat; Focus is what lets you qualify for stronger bracers and heavier magical tools.',
    ],
    paragraphs: [
      'If you picture a mage, medic, or tactician, Focus is usually non-negotiable alongside your combat stat.',
      'Presence is charm and leadership in the open; Focus is the tight read on danger and the steady hand on the conduit.',
    ],
  },
  presence: {
    label: 'Presence',
    summary: 'Force of personality—commanding respect, bending social outcomes, and steering scenes without a blade.',
    bullets: [
      'Equipment: few items key off Presence the way they do Power, Agility, or Focus; social tests use your score and modifiers directly.',
      'Chosen path: if Presence is your Chosen Attribute, its modifier feeds Base RP (Level + Chosen modifier + Growth Pool)—words can be your combat spine.',
      'Play: intimidation, persuasion, performances, bargains, and rallying allies when the fight is about nerve.',
    ],
    paragraphs: [
      'High Presence means the table believes you when you negotiate or stare someone down.',
      'Face characters still need other stats for gear and survival—plan a secondary attribute so you are not locked out of equipment you want.',
    ],
  },
};

// ── Design tokens ─────────────────────────────────────────────────────────
const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', goldDim: '#5a3e10', goldGlow: '#c4922a22',
  text: '#e4d8c0', textMuted: '#706858', textDim: '#282430',
  hp: '#e05050', rp: '#4a9de8', success: '#3dba6a',
  power: '#e87050', agility: '#50c878', focus: '#7090e8', presence: '#e8b050',
};

const ATTR_COLOR: Record<string, string> = {
  Power: T.power, Agility: T.agility, Focus: T.focus, Presence: T.presence,
};

const ATTRS = ['Power', 'Agility', 'Focus', 'Presence'] as const;
type Attr = typeof ATTRS[number];

const toAttrKey = (a: Attr): AttrHelpKey => a.toLowerCase() as AttrHelpKey;

const HELP_KEY_ATTR: Record<AttrHelpKey, Attr> = {
  power: 'Power', agility: 'Agility', focus: 'Focus', presence: 'Presence',
};

// ── SRD formulas ──────────────────────────────────────────────────────────
const calcMod    = (v: number) => Math.floor((v - 10) / 2);
const calcBaseRP = (level: number, chosenVal: number, growthPool: number) =>
  level + calcMod(chosenVal) + growthPool;
const calcMaxHP  = (baseRP: number, level: number) =>
  baseRP * Math.pow(level + 10, 2);
const fmtNum = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
};
// ── Step definitions ──────────────────────────────────────────────────────
const STEPS = [
  { num: 1, label: 'ORIGIN',     sub: 'Name & Backstory'  },
  { num: 2, label: 'ATTRIBUTES', sub: 'Roll & Assign'     },
  { num: 3, label: 'CALLING',    sub: 'Choose Your Path'  },
  { num: 4, label: 'EQUIPMENT',  sub: 'Starting Gear'     },
  { num: 5, label: 'DESTINY',    sub: 'Seal Your Legend'  },
];

interface PoolEntry { id: number; rolls: number[]; result: number; }

/** Reserved width for attribute guide (steps 2–3) so the main column never reflows when the panel appears. */
const ATTR_GUIDE_RAIL_PX = 300;
const ATTR_GUIDE_GAP_PX  = 28;

// ── Style helpers ─────────────────────────────────────────────────────────
const inp = (x: React.CSSProperties = {}): React.CSSProperties => ({
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  borderRadius: '3px', padding: '10px 14px', fontSize: '18px',
  fontFamily: "'EB Garamond', serif", outline: 'none', width: '100%', ...x,
});
const lbl: React.CSSProperties = {
  fontFamily: "'Cinzel', serif", fontSize: '13px', letterSpacing: '0.14em',
  color: T.textMuted, display: 'block', marginBottom: '6px',
};
const mkBtn = (color = T.gold, filled = false): React.CSSProperties => ({
  background: filled ? color : 'transparent',
  border: `1px solid ${color}`, color: filled ? '#06070c' : color,
  fontFamily: "'Cinzel', serif", fontSize: '14px', letterSpacing: '0.14em',
  padding: '10px 24px', borderRadius: '3px', cursor: 'pointer',
});

// ─────────────────────────────────────────────────────────────────────────
/** Only rendered while an attribute is hovered or focused — no placeholder column. */
function AttributeHelpPanel({ highlighted }: { highlighted: AttrHelpKey | null }) {
  if (!highlighted) return null;
  const help = ATTRIBUTE_HELP[highlighted];
  const accent = ATTR_COLOR[HELP_KEY_ATTR[highlighted]];
  return (
    <aside
      style={{
        width: '100%', boxSizing: 'border-box', flexShrink: 0, alignSelf: 'flex-start',
        background: T.card, border: `1px solid ${T.gold}33`,
        borderTop: `2px solid ${accent}`, borderLeft: `3px solid ${accent}`,
        borderRadius: '4px', padding: '18px 16px',
        boxShadow: `0 0 24px ${accent}14`,
        transition: 'border-color .15s, box-shadow .15s',
      }}
    >
      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '12px', letterSpacing: '.2em', color: T.textMuted, marginBottom: '12px' }}>
        ATTRIBUTE GUIDE
      </div>
      <div style={{ fontFamily: "'Cinzel', serif", fontSize: '19px', letterSpacing: '.12em', color: accent, fontWeight: 600, marginBottom: '8px' }}>
        {help.label}
      </div>
      <p style={{ fontFamily: "'EB Garamond', serif", fontSize: '17px', lineHeight: 1.65, color: T.textMuted, margin: '0 0 12px', fontStyle: 'italic' }}>
        {help.summary}
      </p>
      {help.bullets && help.bullets.length > 0 && (
        <ul style={{ margin: '0 0 14px', paddingLeft: '0', listStyle: 'none', color: T.text, fontFamily: "'EB Garamond', serif", fontSize: '15px', lineHeight: 1.55 }}>
          {help.bullets.map((b, i) => (
            <li key={i} style={{ marginBottom: '6px', paddingLeft: '2px' }}>
              <span style={{ color: accent, marginRight: '6px' }}>▸</span>
              {b}
            </li>
          ))}
        </ul>
      )}
      {help.paragraphs.map((p, i) => (
        <p key={i} style={{ fontFamily: "'EB Garamond', serif", fontSize: '16px', lineHeight: 1.7, color: T.text, margin: '0 0 12px' }}>
          {p}
        </p>
      ))}
    </aside>
  );
}

export default function CharacterWizard() {
  const navigate = useNavigate();
  const subscriptionTier = useAuthStore((s) => s.user?.subscription_tier ?? 'free');
  const canCreateCustom = subscriptionTier !== 'free';
  const [step, setStep]               = useState(1);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  // ── Step 1 ────────────────────────────────────────────────────────────
  const [name, setName]               = useState('');
  const [backstory, setBackstory]     = useState('');
  const [abilityDrafts, setAbilityDrafts] = useState<SpecialAbilityDraft[]>([]);
  const [portrait, setPortrait]       = useState<string | null>(null);
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Step 2: pool-then-assign ──────────────────────────────────────────
  const [pool, setPool]               = useState<PoolEntry[]>([]);
  const [growthPool, setGrowthPool]       = useState<number | null>(null);
  const [mulliganUsed, setMulliganUsed]   = useState<number>(0);
  const [rollError, setRollError]         = useState('');
  const { requestRoll, rolling: diceAnimRolling } = useWizardDiceRoll();
  // selected pool entry id waiting to be assigned
  const [selected, setSelected]       = useState<number | null>(null);
  const [assignment, setAssignment]   = useState<Record<Attr, number | null>>({
    Power: null, Agility: null, Focus: null, Presence: null,
  });
  const [highlightedAttr, setHighlightedAttr] = useState<'power' | 'agility' | 'focus' | 'presence' | null>(null);
  const nextId = useRef(0);

  // ── Step 3 ────────────────────────────────────────────────────────────
  const [chosen, setChosen]           = useState<Attr>('Power');

  // ── Step 4: starting equipment (library picks; committed after character POST) ──
  const [startingGear, setStartingGear] = useState<StartingGearState>({});

  // ── Derived ───────────────────────────────────────────────────────────
  const allAssigned = ATTRS.every(a => assignment[a] !== null);
  const attrs: Record<Attr, number> = {
    Power:    pool.find(p => p.id === assignment.Power)?.result    ?? 10,
    Agility:  pool.find(p => p.id === assignment.Agility)?.result  ?? 10,
    Focus:    pool.find(p => p.id === assignment.Focus)?.result    ?? 10,
    Presence: pool.find(p => p.id === assignment.Presence)?.result ?? 10,
  };
  const gp = growthPool ?? 0;
  const baseRP = calcBaseRP(1, attrs[chosen], gp);
  const maxHP  = calcMaxHP(baseRP, 1);

  /** Vertical offset so panel bottom meets the 2×2 grid; horizontal width is fixed by ATTR_GUIDE_RAIL_PX. */
  const stepRowRef     = useRef<HTMLDivElement>(null);
  const guideTargetRef = useRef<HTMLDivElement>(null);
  const guideWrapRef   = useRef<HTMLDivElement>(null);
  const [guidePanelOffset, setGuidePanelOffset] = useState(0);

  const recalcGuideOffset = useCallback(() => {
    const row    = stepRowRef.current;
    const target = guideTargetRef.current;
    const wrap   = guideWrapRef.current;
    if (!row || !target || !wrap || !highlightedAttr || (step !== 2 && step !== 3)) {
      setGuidePanelOffset(0);
      return;
    }
    const aside = wrap.querySelector('aside');
    if (!aside) {
      setGuidePanelOffset(0);
      return;
    }
    const rowTop       = row.getBoundingClientRect().top;
    const targetBottom = target.getBoundingClientRect().bottom;
    const h            = aside.getBoundingClientRect().height;
    setGuidePanelOffset(Math.max(0, Math.round(targetBottom - rowTop - h)));
  }, [step, highlightedAttr]);

  useLayoutEffect(() => {
    recalcGuideOffset();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(recalcGuideOffset) : null;
    const row    = stepRowRef.current;
    const target = guideTargetRef.current;
    const wrap   = guideWrapRef.current;
    if (row)    ro?.observe(row);
    if (target) ro?.observe(target);
    if (wrap)   ro?.observe(wrap);
    window.addEventListener('resize', recalcGuideOffset);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', recalcGuideOffset);
    };
  }, [recalcGuideOffset, pool.length, assignment, allAssigned, growthPool, chosen, diceAnimRolling]);

  useEffect(() => { setHighlightedAttr(null); }, [step]);

  // ── Portrait ──────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setPortraitFile(file);
    const r = new FileReader();
    r.onload = e => setPortrait(e.target?.result as string);
    r.readAsDataURL(file);
  };

  // ── Dice pool (physics animation via GlobalDiceOverlay) ─────────────────
  const rollOne = useCallback(async () => {
    if (diceAnimRolling || pool.length >= 4) return;
    setRollError('');
    try {
      const { rolls, result } = await requestRoll('attr3d20', 'Attribute Pool — 3d20 avg');
      const id = nextId.current++;
      setPool((prev) => [...prev, { id, rolls, result }]);
    } catch (err: unknown) {
      setRollError(err instanceof Error ? err.message : 'Dice roll failed');
    }
  }, [diceAnimRolling, pool.length, requestRoll]);

  const rollAll = useCallback(async () => {
    if (diceAnimRolling) return;
    const needed = 4 - pool.length;
    if (!needed) return;
    setRollError('');
    try {
      for (let i = 0; i < needed; i++) {
        const { rolls, result } = await requestRoll(
          'attr3d20',
          `Attribute Pool ${pool.length + i + 1} of 4 — 3d20 avg`,
        );
        const id = nextId.current++;
        setPool((prev) => [...prev, { id, rolls, result }]);
      }
    } catch (err: unknown) {
      setRollError(err instanceof Error ? err.message : 'Dice roll failed');
    }
  }, [diceAnimRolling, pool.length, requestRoll]);

  const rollGrowth = useCallback(async () => {
    if (diceAnimRolling || growthPool !== null) return;
    setRollError('');
    try {
      const { result } = await requestRoll('growth1d6', 'Growth Pool — 1d6');
      setGrowthPool(result);
    } catch (err: unknown) {
      setRollError(err instanceof Error ? err.message : 'Dice roll failed');
    }
  }, [diceAnimRolling, growthPool, requestRoll]);

  const doMulligan = () => {
    setPool([]);
    setAssignment({ Power: null, Agility: null, Focus: null, Presence: null });
    setSelected(null);
    setGrowthPool(null);
    setRollError('');
    setMulliganUsed(prev => prev + 1);
  };

  // ── Assignment ────────────────────────────────────────────────────────
  const assignTo = (attr: Attr, poolId: number) => {
    setAssignment(prev => {
      const n = { ...prev };
      // Free any attr that previously held this entry
      for (const a of ATTRS) if (n[a] === poolId) n[a] = null;
      // If swapping: put displaced entry back (it just becomes unassigned)
      n[attr] = poolId;
      return n;
    });
    setSelected(null);
  };

  const unassign = (attr: Attr) => setAssignment(prev => ({ ...prev, [attr]: null }));

  // Which pool entries aren't assigned to any attr
  const freePool = pool.filter(p => !ATTRS.some(a => assignment[a] === p.id));

  // ── Navigation ────────────────────────────────────────────────────────
  const canAdvance = () => {
    if (step === 1) return name.trim().length >= 2;
    if (step === 2) return allAssigned && growthPool !== null;
    return true;
  };

  const goBack  = () => step > 1 ? setStep(s => s - 1) : navigate('/characters');
  const goFwd   = () => canAdvance() && step < 5 && setStep(s => s + 1);
  // Left-panel step click — only allow going to already-visited steps
  const jumpTo  = (n: number) => { if (n < step) setStep(n); };

  // ── Submit ────────────────────────────────────────────────────────────
  const confirm = async () => {
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post('/characters', {
        name:             name.trim(),
        backstory:        backstory.trim(),
        power:            attrs.Power,
        agility:          attrs.Agility,
        focus:            attrs.Focus,
        presence:         attrs.Presence,
        chosen_attribute: chosen.toLowerCase(),
        growth_pool:      gp,
        special_abilities: abilityDrafts.map((d) => {
          const p = draftToPayload(d);
          if (d.ability_id) return { ability_id: d.ability_id };
          return p;
        }),
      });
      try {
        await commitStartingEquipment(data.id, startingGear);
      } catch (gearErr) {
        console.error('[CharacterWizard] Starting equipment failed:', gearErr);
        // Character exists; sheet can equip manually
      }
      navigate(`/characters/${data.id}`);
    } catch (err) {
      setError(extractApiError(err).message);
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes diceIn  { from { opacity:0; transform:translateY(-6px) scale(.85) } to { opacity:1; transform:none } }
        @keyframes fadeIn  { from { opacity:0; transform:translateX(12px) } to { opacity:1; transform:none } }
        @keyframes pulse   { 0%,100%{box-shadow:0 0 8px ${T.gold}33} 50%{box-shadow:0 0 22px ${T.gold}66} }
        .pool-card:hover   { border-color:${T.gold} !important; }
        .attr-slot:hover   { border-color:${T.gold}88 !important; }
        .step-lbl:hover    { color:${T.gold} !important; }
      `}</style>

      <div style={{ minHeight:'calc(100vh - 52px)', display:'grid', gridTemplateColumns:'280px 1fr', background:T.bg }}>

        {/* ── Left rail ─────────────────────────────────────────────── */}
        <div style={{ background:T.surface, borderRight:`1px solid ${T.border}`, padding:'40px 28px', display:'flex', flexDirection:'column' }}>
          <div style={{ marginBottom:'36px' }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'.3em', color:T.textMuted, marginBottom:'6px' }}>VELION MYTHERA</div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize: '19px', color:T.gold, letterSpacing:'.14em', fontWeight:600 }}>CHARACTER CREATION</div>
          </div>

          {/* Step nav */}
          <div style={{ flex:1 }}>
            {STEPS.map((s, i) => {
              const active = step === s.num, done = step > s.num, clickable = s.num < step;
              return (
                <div key={s.num} style={{ display:'flex', gap:'14px' }}>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', width:'24px', flexShrink:0 }}>
                    <div
                      onClick={() => clickable && jumpTo(s.num)}
                      style={{
                        width:'24px', height:'24px', borderRadius:'50%', flexShrink:0,
                        background: active ? T.gold : done ? T.goldDim : T.card,
                        border:`2px solid ${active ? T.gold : done ? T.goldDim : T.border}`,
                        display:'flex', alignItems:'center', justifyContent:'center',
                        fontFamily:"'Cinzel',serif", fontSize: '13px', fontWeight:700,
                        color: active ? '#06070c' : done ? T.gold : T.textMuted,
                        animation: active ? 'pulse 2s ease-in-out infinite' : 'none',
                        cursor: clickable ? 'pointer' : 'default', transition:'all .3s', zIndex:1,
                      }}
                    >{done ? '✓' : s.num}</div>
                    {i < STEPS.length - 1 && (
                      <div style={{ width:'2px', flex:1, minHeight:'32px', background: done ? T.goldDim : T.border, transition:'background .3s' }} />
                    )}
                  </div>
                  <div
                    className="step-lbl"
                    onClick={() => clickable && jumpTo(s.num)}
                    style={{ paddingBottom: i < STEPS.length-1 ? '32px' : 0, paddingTop:'2px', cursor: clickable ? 'pointer' : 'default' }}
                  >
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'.14em', color: active ? T.gold : done ? T.text : T.textMuted, marginBottom:'2px', transition:'color .2s' }}>
                      {s.label}
                    </div>
                    <div style={{ fontFamily:"'EB Garamond',serif", fontSize: '16px', color: active ? T.textMuted : T.textDim }}>
                      {s.sub}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live preview */}
          {(name || allAssigned) && (
            <div style={{ marginTop:'32px', background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${ATTR_COLOR[chosen]}`, borderRadius:'4px', padding:'16px', animation:'fadeIn .3s ease-out' }}>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'.2em', color:T.textMuted, marginBottom:'10px' }}>PREVIEW</div>
              {portrait && <img src={portrait} alt="" style={{ width:'48px', height:'48px', objectFit:'cover', borderRadius:'3px', border:`1px solid ${T.border}`, marginBottom:'10px', display:'block' }} />}
              {name && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '17px', color:T.text, marginBottom:'4px', fontWeight:600 }}>{name}</div>}
              {step >= 3 && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', color:ATTR_COLOR[chosen], letterSpacing:'.1em', marginBottom:'12px' }}>LVL 1 · {chosen.toUpperCase()}</div>}
              {allAssigned && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px', marginBottom: step >= 3 ? '10px' : 0 }}>
                  {ATTRS.map(a => (
                    <div key={a} style={{ background:T.surface, borderRadius:'3px', padding:'5px 8px', border:`1px solid ${a === chosen && step >= 3 ? ATTR_COLOR[a]+'44' : T.border}` }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:ATTR_COLOR[a], letterSpacing:'.1em' }}>{a.slice(0,3).toUpperCase()}</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '19px', color:T.text }}>{attrs[a]}</div>
                    </div>
                  ))}
                </div>
              )}
              {step >= 3 && baseRP > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px' }}>
                  {[{l:'BASE RP', v:String(baseRP), c:T.rp},{l:'MAX HP', v:fmtNum(maxHP), c:T.hp}].map(({l,v,c}) => (
                    <div key={l} style={{ background:T.surface, borderRadius:'3px', padding:'5px 8px' }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:c, letterSpacing:'.1em' }}>{l}</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '19px', color:T.text }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Main content ──────────────────────────────────────────── */}
        <div style={{
          padding:'56px 64px', display:'flex', flexDirection:'column',
          maxWidth: step === 2 || step === 3
            ? `${760 + ATTR_GUIDE_GAP_PX + ATTR_GUIDE_RAIL_PX}px`
            : '760px',
          width:'100%',
        }}>
          <div key={step} style={{ animation:'fadeIn .25s ease-out', flex:1 }}>

            {/* ══ STEP 1: ORIGIN ════════════════════════════════════════ */}
            {step === 1 && <>
              <Heading num={1} title="ORIGIN" sub="Who are you before the world knows your name?" />

              {/* Portrait */}
              <div style={{ marginBottom:'28px' }}>
                <label style={lbl}>PORTRAIT <Opt /></label>
                <div style={{ display:'flex', gap:'20px', alignItems:'flex-start' }}>
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{ width:'96px', height:'96px', flexShrink:0, background:T.surface, border:`2px dashed ${portrait ? T.gold : T.border}`, borderRadius:'4px', cursor:'pointer', overflow:'hidden', display:'flex', alignItems:'center', justifyContent:'center', transition:'border-color .2s' }}
                  >
                    {portrait
                      ? <img src={portrait} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                      : <span style={{ fontSize: '31px', opacity:.3 }}>⚔</span>}
                  </div>
                  <div>
                    <p style={{ color:T.textMuted, fontSize: '17px', lineHeight:'1.6', fontFamily:"'EB Garamond',serif", marginBottom:'12px' }}>
                      Upload a portrait for your character. PNG, JPEG, or WEBP.<br />
                      A default portrait will be assigned if none is provided.
                    </p>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={() => fileRef.current?.click()} style={{ ...mkBtn(T.textMuted), padding:'7px 16px', fontSize: '13px' }}>
                        {portrait ? 'CHANGE IMAGE' : 'UPLOAD PORTRAIT'}
                      </button>
                      {portrait && (
                        <button onClick={() => { setPortrait(null); setPortraitFile(null); }} style={{ ...mkBtn(T.hp), padding:'7px 16px', fontSize: '13px' }}>
                          REMOVE
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display:'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </div>

              {/* Name */}
              <div style={{ marginBottom:'24px' }}>
                <label style={lbl}>CHARACTER NAME <span style={{ color:T.hp }}>*</span></label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Enter a name..." autoFocus
                  style={inp({ fontSize: '25px', padding:'12px 16px', color:T.gold, letterSpacing:'.05em' })} />
                {name.length > 0 && name.length < 2 && (
                  <div style={{ color:T.hp, fontSize: '15px', marginTop:'4px', fontFamily:"'EB Garamond',serif" }}>Name must be at least 2 characters.</div>
                )}
              </div>

              {/* Backstory */}
              <div style={{ marginBottom:'32px' }}>
                <label style={lbl}>BACKSTORY <Opt /></label>
                <textarea value={backstory} onChange={e => setBackstory(e.target.value)}
                  placeholder="Describe your character's origin, motivations, and history. There are no rules here."
                  rows={7} style={{ ...inp(), resize:'vertical', lineHeight:'1.7', fontStyle: backstory ? 'normal' : 'italic' }} />
                <div style={{ textAlign:'right', fontSize: '15px', color:T.textMuted, marginTop:'4px', fontFamily:"'EB Garamond',serif" }}>{backstory.length} characters</div>
              </div>

              <div style={{ marginBottom:'28px' }}>
                <label style={lbl}>SPECIAL ABILITIES <Opt /></label>
                <SpecialAbilitiesPanel
                  mode="wizard"
                  drafts={abilityDrafts}
                  onDraftsChange={setAbilityDrafts}
                  canCreateCustom={canCreateCustom}
                />
              </div>

              <Callout>"In Velion Mythera, your character's story is not written by their class or race — it is written by what they carry, what they choose, and how far they are willing to push beyond their limits."</Callout>
            </>}

            {/* ══ STEP 2: ATTRIBUTES ════════════════════════════════════ */}
            {step === 2 && <>
            <div
              ref={stepRowRef}
              style={{
                display: 'grid',
                gridTemplateColumns: `minmax(0, 1fr) ${ATTR_GUIDE_RAIL_PX}px`,
                columnGap: ATTR_GUIDE_GAP_PX,
                alignItems: 'start',
              }}
              onMouseLeave={() => setHighlightedAttr(null)}
            >
              <div style={{ minWidth: 0 }}>
              <Heading num={2} title="ATTRIBUTES" sub="Roll your pool, then assign each result where you want it." />

              <Callout title="THE METHOD">
                Roll <strong style={{ color:T.text }}>4 times</strong>. Each roll averages 3d20 and rounds down.
                Once you have all 4 results, assign them to your attributes however you like.
                If you dislike your entire set, invoke the <strong style={{ color:T.gold }}>Mulligan Rule</strong> to
                wipe all 4 results and start fresh. You may do this as many times as you like —
                but every roll in the set changes, not just the bad one.
              </Callout>

              {/* Roll controls */}
              <div style={{ display:'flex', gap:'12px', marginBottom:'28px', alignItems:'center', flexWrap:'wrap' }}>
                {pool.length < 4 && <>
                  <button type="button" onClick={() => void rollOne()} disabled={diceAnimRolling} style={{ ...mkBtn(T.gold, true), padding:'11px 28px', opacity: diceAnimRolling ? .5 : 1 }}>
                    {diceAnimRolling ? 'ROLLING…' : '⬡ ROLL ONE'}
                  </button>
                  <button type="button" onClick={() => void rollAll()} disabled={diceAnimRolling} style={{ ...mkBtn(T.gold), padding:'11px 28px', opacity: diceAnimRolling ? .5 : 1 }}>
                    {diceAnimRolling ? 'ROLLING…' : `ROLL ALL ${4 - pool.length} REMAINING`}
                  </button>
                </>}
                {pool.length === 4 && !allAssigned && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'.14em', color:T.gold }}>✦ All results in — assign each one below</div>}
                {allAssigned && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'.14em', color:T.success }}>✦ All attributes assigned</div>}
                {pool.length > 0 && (
                  <button onClick={doMulligan} style={{ ...mkBtn(T.hp), padding:'9px 20px', fontSize: '13px', marginLeft:'auto' }}>
                    ✕ MULLIGAN — REROLL EVERYTHING
                  </button>
                )}
              </div>

              {rollError && (
                <div style={{ fontFamily:"'EB Garamond',serif", fontSize: '16px', color: T.hp, marginBottom: '16px' }}>
                  {rollError}
                </div>
              )}

              {diceAnimRolling && (
                <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing: '.14em', color: T.gold, marginBottom: '20px' }}>
                  Dice are rolling on the table…
                </div>
              )}

              {/* Pool */}
              {pool.length > 0 && <>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'12px' }}>
                  ROLLED RESULTS — Click a result to select it, then click an attribute slot to assign it
                </div>
                <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'28px' }}>
                  {pool.map(entry => {
                    const isAssigned = ATTRS.some(a => assignment[a] === entry.id);
                    const isSel      = selected === entry.id;
                    const assignedAttr = ATTRS.find(a => assignment[a] === entry.id);
                    return (
                      <div
                        key={entry.id}
                        className="pool-card"
                        role="button"
                        tabIndex={isAssigned ? -1 : 0}
                        aria-label={assignedAttr ? `Rolled ${entry.result}, assigned to ${assignedAttr}` : `Rolled ${entry.result}, select to assign`}
                        onClick={() => { if (!isAssigned) setSelected(prev => prev === entry.id ? null : entry.id); }}
                        onMouseEnter={() => {
                          if (assignedAttr) setHighlightedAttr(toAttrKey(assignedAttr));
                          else setHighlightedAttr(null);
                        }}
                        onMouseLeave={() => setHighlightedAttr(null)}
                        onFocus={() => {
                          if (assignedAttr) setHighlightedAttr(toAttrKey(assignedAttr));
                          else setHighlightedAttr(null);
                        }}
                        onBlur={() => setHighlightedAttr(null)}
                        onKeyDown={e => {
                          if (isAssigned) return;
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          setSelected(prev => prev === entry.id ? null : entry.id);
                        }}
                        style={{
                          background:   isSel ? T.goldGlow : isAssigned ? T.surface : T.card,
                          border:       `2px solid ${isSel ? T.gold : isAssigned ? T.border : T.goldDim}`,
                          borderRadius: '4px', padding:'12px 16px', minWidth:'130px',
                          cursor:       isAssigned ? 'default' : 'pointer',
                          opacity:      isAssigned ? .4 : 1,
                          transition:   'all .15s', animation:'diceIn .3s ease-out both',
                        }}
                      >
                        {/* Individual dice */}
                        <div style={{ display:'flex', gap:'5px', marginBottom:'8px' }}>
                          {entry.rolls.map((r, i) => (
                            <div key={i} style={{ width:'26px', height:'26px', background:T.surface, border:`1px solid ${T.border}`, borderRadius:'3px', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Cinzel',serif", fontSize: '14px', color:T.textMuted }}>{r}</div>
                          ))}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '29px', color: isSel ? T.gold : T.text, fontWeight:700 }}>{entry.result}</div>
                        </div>
                        {isSel && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.gold, letterSpacing:'.1em', marginTop:'4px' }}>SELECT AN ATTRIBUTE ↓</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Mulligan count */}
                {mulliganUsed > 0 && (
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.textMuted, letterSpacing:'.12em', marginBottom:'20px' }}>
                    MULLIGAN USED {mulliganUsed} TIME{mulliganUsed !== 1 ? 'S' : ''} — No limit
                  </div>
                )}
              </>}

              {pool.length > 0 && (
                <>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'12px' }}>ASSIGN TO ATTRIBUTES</div>
                <div ref={guideTargetRef} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                  {ATTRS.map(attr => {
                    const entry = pool.find(p => p.id === assignment[attr]);
                    const color = ATTR_COLOR[attr];
                    const willReceive = selected !== null && !entry;
                    const willSwap    = selected !== null && !!entry && assignment[attr] !== selected;
                    return (
                      <div
                        key={attr}
                        role="button"
                        tabIndex={0}
                        className="attr-slot"
                        onMouseEnter={() => setHighlightedAttr(toAttrKey(attr))}
                        onFocus={() => setHighlightedAttr(toAttrKey(attr))}
                        onBlur={() => setHighlightedAttr(null)}
                        onClick={() => {
                          setHighlightedAttr(toAttrKey(attr));
                          if (selected !== null) { assignTo(attr, selected); }
                          else if (entry) { unassign(attr); }
                        }}
                        onKeyDown={e => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault();
                          setHighlightedAttr(toAttrKey(attr));
                          if (selected !== null) assignTo(attr, selected);
                          else if (entry) unassign(attr);
                        }}
                        style={{
                          background:   entry ? `${color}0e` : willReceive||willSwap ? T.goldGlow : T.card,
                          border:       `2px solid ${entry ? color+'66' : willReceive||willSwap ? T.gold+'88' : T.border}`,
                          borderRadius: '4px', padding:'16px', minHeight:'90px',
                          cursor:       selected !== null || entry ? 'pointer' : 'default',
                          transition:   'all .15s',
                        }}
                      >
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', color, letterSpacing:'.14em' }}>{attr.toUpperCase()}</div>
                          {entry && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.textMuted }}>CLICK TO UNASSIGN</div>}
                          {willSwap && !entry && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.gold }}>CLICK TO ASSIGN</div>}
                        </div>
                        {entry ? (
                          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                            <div style={{ fontFamily:"'Cinzel',serif", fontSize: '35px', color, fontWeight:700, lineHeight:1 }}>{entry.result}</div>
                            <div style={{ fontFamily:"'Cinzel',serif", fontSize: '17px', color:T.textMuted }}>{calcMod(entry.result)>=0?'+':''}{calcMod(entry.result)} mod</div>
                          </div>
                        ) : (
                          <div style={{ fontFamily:"'EB Garamond',serif", fontSize: '17px', color:T.textDim, fontStyle:'italic' }}>
                            {selected !== null ? 'Click to assign' : 'No value assigned'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </>
              )}

              {/* ── Growth Pool Roll ───────────────────────────────────── */}
              {allAssigned && (
                <div style={{ marginTop:'28px' }}>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'12px' }}>
                    GROWTH POOL — Roll 1d6
                  </div>
                  <div style={{ background:T.card, border:`1px solid ${growthPool ? T.gold+'44' : T.border}`, borderLeft:`3px solid ${growthPool ? T.gold : T.goldDim}`, borderRadius:'4px', padding:'20px', display:'flex', alignItems:'center', gap:'24px' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', color:T.gold, letterSpacing:'.14em', marginBottom:'4px' }}>GROWTH POOL</div>
                      <div style={{ fontFamily:"'EB Garamond',serif", fontSize: '16px', color:T.textMuted, lineHeight:'1.5' }}>
                        Rolled once at character creation and added to your Base RP permanently.
                        It grows further at each level-up.
                      </div>
                    </div>
                    <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:'16px' }}>
                      <div style={{
                        width:'64px', height:'64px',
                        background: growthPool ? T.goldGlow : T.surface,
                        border:`2px solid ${growthPool ? T.gold : T.border}`,
                        borderRadius:'6px', display:'flex', alignItems:'center', justifyContent:'center',
                        fontFamily:"'Cinzel',serif",
                        fontSize: growthPool ? '32px' : '20px',
                        color: growthPool ? T.gold : T.textMuted,
                        transition:'all .2s',
                      }}>
                        {growthPool ?? 'd6'}
                      </div>
                      {!growthPool && (
                        <button type="button" onClick={() => void rollGrowth()} disabled={diceAnimRolling}
                          style={{ ...mkBtn(T.gold, true), padding:'11px 24px', opacity: diceAnimRolling ? .5 : 1 }}>
                          {diceAnimRolling ? 'ROLLING…' : '⬡ ROLL d6'}
                        </button>
                      )}
                      {growthPool && (
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', color:T.success, letterSpacing:'.1em', textAlign:'center' }}>
                          ✓ LOCKED IN
                        </div>
                      )}
                    </div>
                  </div>
                  {!growthPool && (
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.gold+'88', letterSpacing:'.12em', marginTop:'8px' }}>
                      ROLL YOUR GROWTH POOL TO CONTINUE
                    </div>
                  )}
                </div>
              )}
              </div>
              <div
                ref={guideWrapRef}
                style={{
                  width: ATTR_GUIDE_RAIL_PX,
                  minWidth: ATTR_GUIDE_RAIL_PX,
                  flexShrink: 0,
                }}
              >
                <div style={{ marginTop: guidePanelOffset, width: '100%' }}>
                  <AttributeHelpPanel highlighted={highlightedAttr} />
                </div>
              </div>
            </div>
            </>}

            {/* ══ STEP 3: CALLING ═══════════════════════════════════════ */}
            {step === 3 && <>
            <div
              ref={stepRowRef}
              style={{
                display: 'grid',
                gridTemplateColumns: `minmax(0, 1fr) ${ATTR_GUIDE_RAIL_PX}px`,
                columnGap: ATTR_GUIDE_GAP_PX,
                alignItems: 'start',
                marginBottom:'32px',
              }}
              onMouseLeave={() => setHighlightedAttr(null)}
            >
              <div style={{ minWidth: 0 }}>
              <Heading num={3} title="CALLING" sub="One attribute defines your path. Choose wisely." />

              <Callout title="THE CHOSEN ATTRIBUTE">
                Your <strong style={{ color:T.text }}>Chosen Attribute</strong> modifier adds directly to your Base RP,
                making it the spine of your combat identity. This choice can be changed at level-up.{' '}
                <strong style={{ color:T.text }}>Base RP = Level + Chosen Modifier + Growth Pool</strong>
              </Callout>

                <div ref={guideTargetRef} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
                {ATTRS.map(attr => {
                  const val=attrs[attr], mod=calcMod(val), isChosen=chosen===attr, color=ATTR_COLOR[attr];
                  const thisRP=calcBaseRP(1,val,gp), thisHP=calcMaxHP(thisRP,1);
                  return (
                    <button key={attr}
                      type="button"
                      onMouseEnter={() => setHighlightedAttr(toAttrKey(attr))}
                      onFocus={() => setHighlightedAttr(toAttrKey(attr))}
                      onBlur={() => setHighlightedAttr(null)}
                      onClick={() => { setHighlightedAttr(toAttrKey(attr)); setChosen(attr); }}
                      style={{ background: isChosen ? `${color}14` : T.card, border:`2px solid ${isChosen ? color : T.border}`, borderRadius:'4px', padding:'20px', cursor:'pointer', textAlign:'left', transition:'all .2s' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize: '16px', color, letterSpacing:'.14em' }}>{attr.toUpperCase()}</div>
                        {isChosen && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:'#06070c', background:color, padding:'2px 8px', borderRadius:'2px' }}>CHOSEN</div>}
                      </div>
                      <div style={{ display:'flex', gap:'16px', marginBottom:'14px' }}>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.textMuted, marginBottom:'2px' }}>SCORE</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '27px', color:T.text }}>{val}</div>
                        </div>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.textMuted, marginBottom:'2px' }}>MODIFIER</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '27px', color }}>{mod>=0?`+${mod}`:mod}</div>
                        </div>
                      </div>
                      <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:'10px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.rp, letterSpacing:'.1em', marginBottom:'2px' }}>BASE RP</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '18px', color:T.text }}>{thisRP}</div>
                        </div>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.hp, letterSpacing:'.1em', marginBottom:'2px' }}>MAX HP</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize: '18px', color:T.text }}>{fmtNum(thisHP)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
                </div>

              {/* Formula breakdown */}
              <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'4px', padding:'20px 24px', marginTop:'24px' }}>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'14px' }}>
                  YOUR STARTING VALUES WITH {chosen.toUpperCase()} CHOSEN
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'16px', marginBottom:'14px' }}>
                  <FCell label="LEVEL" value="1" color={T.textMuted} />
                  <FCell label={`${chosen.toUpperCase()} MOD`} value={`${calcMod(attrs[chosen])>=0?'+':''}${calcMod(attrs[chosen])}`} color={ATTR_COLOR[chosen]} />
                  <FCell label="GROWTH POOL" value={`+${gp}`} color={T.gold} note="(d6 rolled on creation)" />
                </div>
                <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:'14px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                  <FCell label="BASE RP" value={String(baseRP)} color={T.rp} large />
                  <FCell label="MAX HP" value={fmtNum(maxHP)} color={T.hp} large note={`${baseRP} × (1+10)²`} />
                </div>
              </div>
              </div>
              <div
                ref={guideWrapRef}
                style={{
                  width: ATTR_GUIDE_RAIL_PX,
                  minWidth: ATTR_GUIDE_RAIL_PX,
                  flexShrink: 0,
                }}
              >
                <div style={{ marginTop: guidePanelOffset, width: '100%' }}>
                  <AttributeHelpPanel highlighted={highlightedAttr} />
                </div>
              </div>
            </div>
            </>}

            {/* ══ STEP 4: EQUIPMENT ═════════════════════════════════════ */}
            {step === 4 && <>
              <Heading num={4} title="EQUIPMENT" sub="Arm yourself for the road ahead." />
              <WizardEquipmentStep
                power={attrs.Power}
                agility={attrs.Agility}
                focus={attrs.Focus}
                presence={attrs.Presence}
                value={startingGear}
                onChange={setStartingGear}
              />
            </>}

            {/* ══ STEP 5: DESTINY ═══════════════════════════════════════ */}
            {step === 5 && <>
              <Heading num={5} title="DESTINY" sub="Review your legend before it begins." />

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px', marginBottom:'24px' }}>
                {/* Identity */}
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.gold}`, borderRadius:'4px', padding:'20px', gridColumn:'1/-1' }}>
                  <SLbl>IDENTITY</SLbl>
                  <div style={{ display:'flex', gap:'16px', alignItems:'flex-start' }}>
                    {portrait && <img src={portrait} alt="" style={{ width:'72px', height:'72px', objectFit:'cover', borderRadius:'3px', border:`1px solid ${T.border}`, flexShrink:0 }} />}
                    <div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '25px', color:T.gold, marginBottom:'4px' }}>{name}</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', color:ATTR_COLOR[chosen], letterSpacing:'.12em' }}>LEVEL 1 · CHOSEN: {chosen.toUpperCase()}</div>
                      {backstory && <p style={{ fontFamily:"'EB Garamond',serif", fontSize: '17px', color:T.textMuted, lineHeight:'1.7', fontStyle:'italic', marginTop:'8px' }}>{backstory.length>200 ? backstory.slice(0,200)+'…' : backstory}</p>}
                    </div>
                  </div>
                </div>

                {/* Attributes */}
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.goldDim}`, borderRadius:'4px', padding:'20px' }}>
                  <SLbl>ATTRIBUTES</SLbl>
                  {ATTRS.map(a => (
                    <div key={a} style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px', alignItems:'center' }}>
                      <span style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.12em', color: a===chosen ? ATTR_COLOR[a] : T.textMuted }}>{a.toUpperCase()} {a===chosen?'★':''}</span>
                      <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                        <span style={{ fontFamily:"'Cinzel',serif", fontSize: '19px', color:T.text }}>{attrs[a]}</span>
                        <span style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', color:ATTR_COLOR[a] }}>{calcMod(attrs[a])>=0?'+':''}{calcMod(attrs[a])}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats */}
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.goldDim}`, borderRadius:'4px', padding:'20px' }}>
                  <SLbl>STARTING STATS</SLbl>
                  <div style={{ marginBottom:'16px' }}>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.rp, letterSpacing:'.12em', marginBottom:'2px' }}>BASE RP</div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '31px', color:T.text }}>{baseRP}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', color:T.hp, letterSpacing:'.12em', marginBottom:'2px' }}>MAX HP</div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '31px', color:T.text }}>{fmtNum(maxHP)}</div>
                  </div>
                </div>

                {/* Starting equipment recap */}
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.goldDim}`, borderRadius:'4px', padding:'20px', gridColumn:'1/-1' }}>
                  <SLbl>STARTING EQUIPMENT</SLbl>
                  {Object.keys(startingGear).length === 0 ? (
                    <p style={{ fontFamily:"'EB Garamond',serif", fontSize: '17px', color:T.textMuted, fontStyle:'italic', margin:0 }}>None selected — you can equip from your character sheet.</p>
                  ) : (
                    <ul style={{ margin:0, paddingLeft:'18px', color:T.text, fontFamily:"'EB Garamond',serif", fontSize: '17px', lineHeight:1.7 }}>
                      {(['main_hand','off_hand','helmet','shirt','chestplate','pants','leggings','gauntlets','boots','bracer'] as const).map(slot => {
                        const g = startingGear[slot];
                        if (!g) return null;
                        const label =
                          slot === 'main_hand' ? 'Main hand'
                          : slot === 'off_hand' ? 'Off hand'
                          : slot === 'chestplate' ? 'Chestplate'
                          : slot.charAt(0).toUpperCase() + slot.slice(1);
                        return <li key={slot}><span style={{ color:T.textMuted }}>{label}:</span> {g.name}</li>;
                      })}
                    </ul>
                  )}
                </div>
              </div>

              {error && (
                <div style={{ background:'#1a0604', border:`1px solid ${T.hp}44`, borderRadius:'3px', padding:'12px 16px', color:T.hp, fontSize: '17px', fontFamily:"'EB Garamond',serif", marginBottom:'16px' }}>
                  {error}
                </div>
              )}

              <button onClick={confirm} disabled={submitting}
                style={{ ...mkBtn(T.gold,true), width:'100%', padding:'16px', fontSize: '16px', letterSpacing:'.2em', opacity: submitting?.6:1, animation: submitting?'none':'pulse 3s ease-in-out infinite' }}>
                {submitting ? 'SEALING YOUR LEGEND…' : '✦ BEGIN YOUR LEGEND ✦'}
              </button>
            </>}

          </div>

          {/* ── Nav bar ─────────────────────────────────────────────── */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'40px', paddingTop:'24px', borderTop:`1px solid ${T.border}` }}>
            <button onClick={goBack} style={{ ...mkBtn(T.textMuted), padding:'10px 20px' }}>
              {step === 1 ? 'CANCEL' : '← BACK'}
            </button>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.16em', color:T.textMuted }}>
              STEP {step} OF {STEPS.length}
            </div>
            {step < 5 ? (
              <button onClick={goFwd} disabled={!canAdvance()}
                style={{ ...mkBtn(T.gold, canAdvance()), padding:'10px 24px', opacity: canAdvance()?1:.35 }}>
                {step === 4 ? 'REVIEW →' : 'CONTINUE →'}
              </button>
            ) : (
              <div style={{ width:'110px' }} />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Shared components ─────────────────────────────────────────────────────

function Heading({ num, title, sub }: { num:number; title:string; sub:string }) {
  return (
    <div style={{ marginBottom:'32px' }}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.3em', color:T.textMuted, marginBottom:'6px' }}>STEP {num} OF {STEPS.length}</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize: '31px', color:T.gold, letterSpacing:'.1em', fontWeight:700, marginBottom:'6px' }}>{title}</h2>
      <p style={{ fontFamily:"'EB Garamond',serif", fontSize: '19px', color:T.textMuted, fontStyle:'italic' }}>{sub}</p>
      <div style={{ height:'1px', background:`linear-gradient(to right,${T.gold}44,transparent)`, marginTop:'16px' }} />
    </div>
  );
}

function Callout({ title, children }: { title?:string; children:React.ReactNode }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`3px solid ${T.goldDim}`, borderRadius:'3px', padding:'14px 18px', marginBottom:'28px' }}>
      {title && <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'.18em', color:T.gold, marginBottom:'6px' }}>{title}</div>}
      <p style={{ color:T.textMuted, fontSize: '17px', lineHeight:'1.7', fontFamily:"'EB Garamond',serif", margin:0, fontStyle: title ? 'normal' : 'italic' }}>{children}</p>
    </div>
  );
}

function FCell({ label, value, color, large, note }: { label:string; value:string; color:string; large?:boolean; note?:string }) {
  return (
    <div>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'.14em', color:T.textMuted, marginBottom:'4px' }}>{label}</div>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize: large?'28px':'20px', color, lineHeight:'1' }}>{value}</div>
      {note && <div style={{ fontFamily:"'EB Garamond',serif", fontSize: '14px', color:T.textMuted, marginTop:'2px', fontStyle:'italic' }}>{note}</div>}
    </div>
  );
}

function SLbl({ children }: { children:React.ReactNode }) {
  return <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'.22em', color:T.textMuted, marginBottom:'12px' }}>{children}</div>;
}

function Opt() {
  return <span style={{ color:T.textMuted, fontStyle:'italic', fontFamily:"'EB Garamond',serif", fontSize: '15px', letterSpacing:0 }}>optional</span>;
}