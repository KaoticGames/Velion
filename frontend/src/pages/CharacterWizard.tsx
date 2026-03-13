import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { extractApiError } from '@/lib/api';

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
const roll3d20avg = () => {
  const rolls = [
    Math.floor(Math.random() * 20) + 1,
    Math.floor(Math.random() * 20) + 1,
    Math.floor(Math.random() * 20) + 1,
  ];
  return { rolls, result: Math.floor((rolls[0] + rolls[1] + rolls[2]) / 3) };
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

// ── Style helpers ─────────────────────────────────────────────────────────
const inp = (x: React.CSSProperties = {}): React.CSSProperties => ({
  background: T.surface, border: `1px solid ${T.border}`, color: T.text,
  borderRadius: '3px', padding: '10px 14px', fontSize: '15px',
  fontFamily: "'EB Garamond', serif", outline: 'none', width: '100%', ...x,
});
const lbl: React.CSSProperties = {
  fontFamily: "'Cinzel', serif", fontSize: '10px', letterSpacing: '0.14em',
  color: T.textMuted, display: 'block', marginBottom: '6px',
};
const mkBtn = (color = T.gold, filled = false): React.CSSProperties => ({
  background: filled ? color : 'transparent',
  border: `1px solid ${color}`, color: filled ? '#06070c' : color,
  fontFamily: "'Cinzel', serif", fontSize: '11px', letterSpacing: '0.14em',
  padding: '10px 24px', borderRadius: '3px', cursor: 'pointer',
});

// ─────────────────────────────────────────────────────────────────────────
export default function CharacterWizard() {
  const navigate = useNavigate();
  const [step, setStep]               = useState(1);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  // ── Step 1 ────────────────────────────────────────────────────────────
  const [name, setName]               = useState('');
  const [backstory, setBackstory]     = useState('');
  const [portrait, setPortrait]       = useState<string | null>(null);
  const [portraitFile, setPortraitFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Step 2: pool-then-assign ──────────────────────────────────────────
  const [pool, setPool]               = useState<PoolEntry[]>([]);
  const [rolling, setRolling]         = useState(false);
  const [animNums, setAnimNums]       = useState<number[]>([]);
  const [growthPool, setGrowthPool]       = useState<number | null>(null);
  const [rollingGrowth, setRollingGrowth] = useState(false);
  const [growthAnim, setGrowthAnim]       = useState<number | null>(null);
  const [mulliganUsed, setMulliganUsed]   = useState<number>(0);
  // selected pool entry id waiting to be assigned
  const [selected, setSelected]       = useState<number | null>(null);
  const [assignment, setAssignment]   = useState<Record<Attr, number | null>>({
    Power: null, Agility: null, Focus: null, Presence: null,
  });
  const nextId = useRef(0);

  // ── Step 3 ────────────────────────────────────────────────────────────
  const [chosen, setChosen]           = useState<Attr>('Power');

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

  // ── Portrait ──────────────────────────────────────────────────────────
  const handleFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setPortraitFile(file);
    const r = new FileReader();
    r.onload = e => setPortrait(e.target?.result as string);
    r.readAsDataURL(file);
  };

  // ── Dice pool ─────────────────────────────────────────────────────────
  const rollOne = useCallback(() => {
    if (rolling || pool.length >= 4) return;
    setRolling(true);
    let frame = 0;
    const iv = setInterval(() => {
      setAnimNums([
        Math.floor(Math.random() * 20) + 1,
        Math.floor(Math.random() * 20) + 1,
        Math.floor(Math.random() * 20) + 1,
      ]);
      if (++frame >= 8) {
        clearInterval(iv);
        const { rolls, result } = roll3d20avg();
        const id = nextId.current++;
        setPool(prev => [...prev, { id, rolls, result }]);
        setRolling(false);
        setAnimNums([]);
      }
    }, 80);
  }, [rolling, pool.length]);

  const rollAll = useCallback(() => {
    if (rolling) return;
    const needed = 4 - pool.length;
    if (!needed) return;
    let done = 0;
    const next = () => {
      if (done >= needed) return;
      const { rolls, result } = roll3d20avg();
      const id = nextId.current++;
      setPool(prev => [...prev, { id, rolls, result }]);
      done++;
      setTimeout(next, 130);
    };
    next();
  }, [rolling, pool.length]);

  const rollGrowth = useCallback(() => {
    if (rollingGrowth || growthPool !== null) return;
    setRollingGrowth(true);
    let frame = 0;
    const iv = setInterval(() => {
      setGrowthAnim(Math.floor(Math.random() * 6) + 1);
      if (++frame >= 8) {
        clearInterval(iv);
        const result = Math.floor(Math.random() * 6) + 1;
        setGrowthPool(result);
        setRollingGrowth(false);
        setGrowthAnim(null);
      }
    }, 80);
  }, [rollingGrowth, growthPool]);

  const doMulligan = () => {
    setPool([]);
    setAssignment({ Power: null, Agility: null, Focus: null, Presence: null });
    setSelected(null);
    setGrowthPool(null);
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
      });
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
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'.3em', color:T.textMuted, marginBottom:'6px' }}>VELION MYTHERA</div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'16px', color:T.gold, letterSpacing:'.14em', fontWeight:600 }}>CHARACTER CREATION</div>
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
                        fontFamily:"'Cinzel',serif", fontSize:'10px', fontWeight:700,
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
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'.14em', color: active ? T.gold : done ? T.text : T.textMuted, marginBottom:'2px', transition:'color .2s' }}>
                      {s.label}
                    </div>
                    <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'13px', color: active ? T.textMuted : T.textDim }}>
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
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'.2em', color:T.textMuted, marginBottom:'10px' }}>PREVIEW</div>
              {portrait && <img src={portrait} alt="" style={{ width:'48px', height:'48px', objectFit:'cover', borderRadius:'3px', border:`1px solid ${T.border}`, marginBottom:'10px', display:'block' }} />}
              {name && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'14px', color:T.text, marginBottom:'4px', fontWeight:600 }}>{name}</div>}
              {step >= 3 && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', color:ATTR_COLOR[chosen], letterSpacing:'.1em', marginBottom:'12px' }}>LVL 1 · {chosen.toUpperCase()}</div>}
              {allAssigned && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px', marginBottom: step >= 3 ? '10px' : 0 }}>
                  {ATTRS.map(a => (
                    <div key={a} style={{ background:T.surface, borderRadius:'3px', padding:'5px 8px', border:`1px solid ${a === chosen && step >= 3 ? ATTR_COLOR[a]+'44' : T.border}` }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:ATTR_COLOR[a], letterSpacing:'.1em' }}>{a.slice(0,3).toUpperCase()}</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'16px', color:T.text }}>{attrs[a]}</div>
                    </div>
                  ))}
                </div>
              )}
              {step >= 3 && baseRP > 0 && (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'5px' }}>
                  {[{l:'BASE RP', v:String(baseRP), c:T.rp},{l:'MAX HP', v:fmtNum(maxHP), c:T.hp}].map(({l,v,c}) => (
                    <div key={l} style={{ background:T.surface, borderRadius:'3px', padding:'5px 8px' }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:c, letterSpacing:'.1em' }}>{l}</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'16px', color:T.text }}>{v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Main content ──────────────────────────────────────────── */}
        <div style={{ padding:'56px 64px', display:'flex', flexDirection:'column', maxWidth:'760px' }}>
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
                      : <span style={{ fontSize:'28px', opacity:.3 }}>⚔</span>}
                  </div>
                  <div>
                    <p style={{ color:T.textMuted, fontSize:'14px', lineHeight:'1.6', fontFamily:"'EB Garamond',serif", marginBottom:'12px' }}>
                      Upload a portrait for your character. PNG, JPEG, or WEBP.<br />
                      A default portrait will be assigned if none is provided.
                    </p>
                    <div style={{ display:'flex', gap:'8px' }}>
                      <button onClick={() => fileRef.current?.click()} style={{ ...mkBtn(T.textMuted), padding:'7px 16px', fontSize:'10px' }}>
                        {portrait ? 'CHANGE IMAGE' : 'UPLOAD PORTRAIT'}
                      </button>
                      {portrait && (
                        <button onClick={() => { setPortrait(null); setPortraitFile(null); }} style={{ ...mkBtn(T.hp), padding:'7px 16px', fontSize:'10px' }}>
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
                  style={inp({ fontSize:'22px', padding:'12px 16px', color:T.gold, letterSpacing:'.05em' })} />
                {name.length > 0 && name.length < 2 && (
                  <div style={{ color:T.hp, fontSize:'12px', marginTop:'4px', fontFamily:"'EB Garamond',serif" }}>Name must be at least 2 characters.</div>
                )}
              </div>

              {/* Backstory */}
              <div style={{ marginBottom:'32px' }}>
                <label style={lbl}>BACKSTORY <Opt /></label>
                <textarea value={backstory} onChange={e => setBackstory(e.target.value)}
                  placeholder="Describe your character's origin, motivations, and history. There are no rules here."
                  rows={7} style={{ ...inp(), resize:'vertical', lineHeight:'1.7', fontStyle: backstory ? 'normal' : 'italic' }} />
                <div style={{ textAlign:'right', fontSize:'12px', color:T.textMuted, marginTop:'4px', fontFamily:"'EB Garamond',serif" }}>{backstory.length} characters</div>
              </div>

              <Callout>"In Velion Mythera, your character's story is not written by their class or race — it is written by what they carry, what they choose, and how far they are willing to push beyond their limits."</Callout>
            </>}

            {/* ══ STEP 2: ATTRIBUTES ════════════════════════════════════ */}
            {step === 2 && <>
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
                  <button onClick={rollOne} disabled={rolling} style={{ ...mkBtn(T.gold, true), padding:'11px 28px', opacity: rolling ? .5 : 1 }}>
                    ⬡ ROLL ONE
                  </button>
                  <button onClick={rollAll} disabled={rolling} style={{ ...mkBtn(T.gold), padding:'11px 28px', opacity: rolling ? .5 : 1 }}>
                    ROLL ALL {4 - pool.length} REMAINING
                  </button>
                </>}
                {pool.length === 4 && !allAssigned && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'.14em', color:T.gold }}>✦ All results in — assign each one below</div>}
                {allAssigned && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'.14em', color:T.success }}>✦ All attributes assigned</div>}
                {pool.length > 0 && (
                  <button onClick={doMulligan} style={{ ...mkBtn(T.hp), padding:'9px 20px', fontSize:'10px', marginLeft:'auto' }}>
                    ✕ MULLIGAN — REROLL EVERYTHING
                  </button>
                )}
              </div>

              {/* Dice animation */}
              {rolling && animNums.length > 0 && (
                <div style={{ display:'flex', gap:'10px', marginBottom:'20px' }}>
                  {animNums.map((n, i) => (
                    <div key={i} style={{ width:'44px', height:'44px', background:T.surface, border:`1px solid ${T.gold}44`, borderRadius:'4px', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Cinzel',serif", fontSize:'18px', color:T.gold+'88' }}>{n}</div>
                  ))}
                </div>
              )}

              {/* Pool */}
              {pool.length > 0 && <>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'12px' }}>
                  ROLLED RESULTS — Click a result to select it, then click an attribute slot to assign it
                </div>
                <div style={{ display:'flex', gap:'10px', flexWrap:'wrap', marginBottom:'28px' }}>
                  {pool.map(entry => {
                    const isAssigned = ATTRS.some(a => assignment[a] === entry.id);
                    const isSel      = selected === entry.id;
                    return (
                      <div
                        key={entry.id}
                        className="pool-card"
                        onClick={() => { if (!isAssigned) setSelected(prev => prev === entry.id ? null : entry.id); }}
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
                            <div key={i} style={{ width:'26px', height:'26px', background:T.surface, border:`1px solid ${T.border}`, borderRadius:'3px', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Cinzel',serif", fontSize:'11px', color:T.textMuted }}>{r}</div>
                          ))}
                        </div>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'26px', color: isSel ? T.gold : T.text, fontWeight:700 }}>{entry.result}</div>
                        </div>
                        {isSel && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.gold, letterSpacing:'.1em', marginTop:'4px' }}>SELECT AN ATTRIBUTE ↓</div>}
                      </div>
                    );
                  })}
                </div>

                {/* Mulligan count */}
                {mulliganUsed > 0 && (
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:T.textMuted, letterSpacing:'.12em', marginBottom:'20px' }}>
                    MULLIGAN USED {mulliganUsed} TIME{mulliganUsed !== 1 ? 'S' : ''} — No limit
                  </div>
                )}
              </>}

              {/* Attribute assignment slots */}
              {pool.length > 0 && <>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'12px' }}>ASSIGN TO ATTRIBUTES</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                  {ATTRS.map(attr => {
                    const entry = pool.find(p => p.id === assignment[attr]);
                    const color = ATTR_COLOR[attr];
                    const willReceive = selected !== null && !entry;
                    const willSwap    = selected !== null && !!entry && assignment[attr] !== selected;
                    return (
                      <div
                        key={attr}
                        className="attr-slot"
                        onClick={() => {
                          if (selected !== null) { assignTo(attr, selected); }
                          else if (entry) { unassign(attr); }
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
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', color, letterSpacing:'.14em' }}>{attr.toUpperCase()}</div>
                          {entry && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.textMuted }}>CLICK TO UNASSIGN</div>}
                          {willSwap && !entry && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.gold }}>CLICK TO ASSIGN</div>}
                        </div>
                        {entry ? (
                          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'32px', color, fontWeight:700, lineHeight:1 }}>{entry.result}</div>
                            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'14px', color:T.textMuted }}>{calcMod(entry.result)>=0?'+':''}{calcMod(entry.result)} mod</div>
                          </div>
                        ) : (
                          <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'14px', color:T.textDim, fontStyle:'italic' }}>
                            {selected !== null ? 'Click to assign' : 'No value assigned'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>}

              {/* ── Growth Pool Roll ───────────────────────────────────── */}
              {allAssigned && (
                <div style={{ marginTop:'28px' }}>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'12px' }}>
                    GROWTH POOL — Roll 1d6
                  </div>
                  <div style={{ background:T.card, border:`1px solid ${growthPool ? T.gold+'44' : T.border}`, borderLeft:`3px solid ${growthPool ? T.gold : T.goldDim}`, borderRadius:'4px', padding:'20px', display:'flex', alignItems:'center', gap:'24px' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', color:T.gold, letterSpacing:'.14em', marginBottom:'4px' }}>GROWTH POOL</div>
                      <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'13px', color:T.textMuted, lineHeight:'1.5' }}>
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
                        fontSize: (growthPool || rollingGrowth) ? '32px' : '20px',
                        color: growthPool ? T.gold : T.textMuted,
                        transition:'all .2s',
                      }}>
                        {rollingGrowth ? (growthAnim ?? '?') : (growthPool ?? 'd6')}
                      </div>
                      {!growthPool && (
                        <button onClick={rollGrowth} disabled={rollingGrowth}
                          style={{ ...mkBtn(T.gold, true), padding:'11px 24px', opacity: rollingGrowth ? .5 : 1 }}>
                          ⬡ ROLL d6
                        </button>
                      )}
                      {growthPool && (
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', color:T.success, letterSpacing:'.1em', textAlign:'center' }}>
                          ✓ LOCKED IN
                        </div>
                      )}
                    </div>
                  </div>
                  {!growthPool && (
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:T.gold+'88', letterSpacing:'.12em', marginTop:'8px' }}>
                      ROLL YOUR GROWTH POOL TO CONTINUE
                    </div>
                  )}
                </div>
              )}
            </>}

            {/* ══ STEP 3: CALLING ═══════════════════════════════════════ */}
            {step === 3 && <>
              <Heading num={3} title="CALLING" sub="One attribute defines your path. Choose wisely." />

              <Callout title="THE CHOSEN ATTRIBUTE">
                Your <strong style={{ color:T.text }}>Chosen Attribute</strong> modifier adds directly to your Base RP,
                making it the spine of your combat identity. This choice can be changed at level-up.{' '}
                <strong style={{ color:T.text }}>Base RP = Level + Chosen Modifier + Growth Pool</strong>
              </Callout>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px', marginBottom:'32px' }}>
                {ATTRS.map(attr => {
                  const val=attrs[attr], mod=calcMod(val), isChosen=chosen===attr, color=ATTR_COLOR[attr];
                  const thisRP=calcBaseRP(1,val,gp), thisHP=calcMaxHP(thisRP,1);
                  return (
                    <button key={attr} onClick={() => setChosen(attr)}
                      style={{ background: isChosen ? `${color}14` : T.card, border:`2px solid ${isChosen ? color : T.border}`, borderRadius:'4px', padding:'20px', cursor:'pointer', textAlign:'left', transition:'all .2s' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'13px', color, letterSpacing:'.14em' }}>{attr.toUpperCase()}</div>
                        {isChosen && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:'#06070c', background:color, padding:'2px 8px', borderRadius:'2px' }}>CHOSEN</div>}
                      </div>
                      <div style={{ display:'flex', gap:'16px', marginBottom:'14px' }}>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:T.textMuted, marginBottom:'2px' }}>SCORE</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'24px', color:T.text }}>{val}</div>
                        </div>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:T.textMuted, marginBottom:'2px' }}>MODIFIER</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'24px', color }}>{mod>=0?`+${mod}`:mod}</div>
                        </div>
                      </div>
                      <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:'10px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.rp, letterSpacing:'.1em', marginBottom:'2px' }}>BASE RP</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'15px', color:T.text }}>{thisRP}</div>
                        </div>
                        <div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.hp, letterSpacing:'.1em', marginBottom:'2px' }}>MAX HP</div>
                          <div style={{ fontFamily:"'Cinzel',serif", fontSize:'15px', color:T.text }}>{fmtNum(thisHP)}</div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Formula breakdown */}
              <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'4px', padding:'20px 24px' }}>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.18em', color:T.textMuted, marginBottom:'14px' }}>
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
            </>}

            {/* ══ STEP 4: EQUIPMENT ═════════════════════════════════════ */}
            {step === 4 && <>
              <Heading num={4} title="EQUIPMENT" sub="Arm yourself for the road ahead." />

              <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.goldDim}`, borderRadius:'4px', padding:'40px', textAlign:'center', marginBottom:'24px' }}>
                <div style={{ fontSize:'36px', marginBottom:'16px' }}>⚔</div>
                <div style={{ fontFamily:"'Cinzel',serif", fontSize:'13px', letterSpacing:'.2em', color:T.gold, marginBottom:'12px' }}>LIBRARY CONNECTION PENDING</div>
                <p style={{ color:T.textMuted, fontSize:'15px', lineHeight:'1.7', fontFamily:"'EB Garamond',serif", maxWidth:'400px', margin:'0 auto 16px' }}>
                  Starting equipment selection will connect to the weapon, armor, and spell gem libraries in a future update.
                  Your character will begin with no equipment equipped.
                </p>
                <p style={{ color:T.textMuted, fontSize:'14px', fontStyle:'italic', fontFamily:"'EB Garamond',serif" }}>
                  You can equip items from your character sheet at any time once the library is populated.
                </p>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                {['Main Hand','Off Hand','Helmet','Chestplate','Leggings','Gauntlets','Boots','Focus Bracer'].map(slot => (
                  <div key={slot} style={{ background:T.surface, border:`1px dashed ${T.border}`, borderRadius:'3px', padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.1em', color:T.textMuted }}>{slot.toUpperCase()}</span>
                    <span style={{ fontFamily:"'EB Garamond',serif", fontSize:'13px', color:T.textDim, fontStyle:'italic' }}>empty</span>
                  </div>
                ))}
              </div>
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
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', color:T.gold, marginBottom:'4px' }}>{name}</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', color:ATTR_COLOR[chosen], letterSpacing:'.12em' }}>LEVEL 1 · CHOSEN: {chosen.toUpperCase()}</div>
                      {backstory && <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'14px', color:T.textMuted, lineHeight:'1.7', fontStyle:'italic', marginTop:'8px' }}>{backstory.length>200 ? backstory.slice(0,200)+'…' : backstory}</p>}
                    </div>
                  </div>
                </div>

                {/* Attributes */}
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.goldDim}`, borderRadius:'4px', padding:'20px' }}>
                  <SLbl>ATTRIBUTES</SLbl>
                  {ATTRS.map(a => (
                    <div key={a} style={{ display:'flex', justifyContent:'space-between', marginBottom:'8px', alignItems:'center' }}>
                      <span style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.12em', color: a===chosen ? ATTR_COLOR[a] : T.textMuted }}>{a.toUpperCase()} {a===chosen?'★':''}</span>
                      <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'16px', color:T.text }}>{attrs[a]}</span>
                        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', color:ATTR_COLOR[a] }}>{calcMod(attrs[a])>=0?'+':''}{calcMod(attrs[a])}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Stats */}
                <div style={{ background:T.card, border:`1px solid ${T.border}`, borderTop:`2px solid ${T.goldDim}`, borderRadius:'4px', padding:'20px' }}>
                  <SLbl>STARTING STATS</SLbl>
                  <div style={{ marginBottom:'16px' }}>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:T.rp, letterSpacing:'.12em', marginBottom:'2px' }}>BASE RP</div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'28px', color:T.text }}>{baseRP}</div>
                  </div>
                  <div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:T.hp, letterSpacing:'.12em', marginBottom:'2px' }}>MAX HP</div>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'28px', color:T.text }}>{fmtNum(maxHP)}</div>
                  </div>
                </div>
              </div>

              {error && (
                <div style={{ background:'#1a0604', border:`1px solid ${T.hp}44`, borderRadius:'3px', padding:'12px 16px', color:T.hp, fontSize:'14px', fontFamily:"'EB Garamond',serif", marginBottom:'16px' }}>
                  {error}
                </div>
              )}

              <button onClick={confirm} disabled={submitting}
                style={{ ...mkBtn(T.gold,true), width:'100%', padding:'16px', fontSize:'13px', letterSpacing:'.2em', opacity: submitting?.6:1, animation: submitting?'none':'pulse 3s ease-in-out infinite' }}>
                {submitting ? 'SEALING YOUR LEGEND…' : '✦ BEGIN YOUR LEGEND ✦'}
              </button>
            </>}

          </div>

          {/* ── Nav bar ─────────────────────────────────────────────── */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:'40px', paddingTop:'24px', borderTop:`1px solid ${T.border}` }}>
            <button onClick={goBack} style={{ ...mkBtn(T.textMuted), padding:'10px 20px' }}>
              {step === 1 ? 'CANCEL' : '← BACK'}
            </button>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.16em', color:T.textMuted }}>
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
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.3em', color:T.textMuted, marginBottom:'6px' }}>STEP {num} OF {STEPS.length}</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'28px', color:T.gold, letterSpacing:'.1em', fontWeight:700, marginBottom:'6px' }}>{title}</h2>
      <p style={{ fontFamily:"'EB Garamond',serif", fontSize:'16px', color:T.textMuted, fontStyle:'italic' }}>{sub}</p>
      <div style={{ height:'1px', background:`linear-gradient(to right,${T.gold}44,transparent)`, marginTop:'16px' }} />
    </div>
  );
}

function Callout({ title, children }: { title?:string; children:React.ReactNode }) {
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderLeft:`3px solid ${T.goldDim}`, borderRadius:'3px', padding:'14px 18px', marginBottom:'28px' }}>
      {title && <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'.18em', color:T.gold, marginBottom:'6px' }}>{title}</div>}
      <p style={{ color:T.textMuted, fontSize:'14px', lineHeight:'1.7', fontFamily:"'EB Garamond',serif", margin:0, fontStyle: title ? 'normal' : 'italic' }}>{children}</p>
    </div>
  );
}

function FCell({ label, value, color, large, note }: { label:string; value:string; color:string; large?:boolean; note?:string }) {
  return (
    <div>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'.14em', color:T.textMuted, marginBottom:'4px' }}>{label}</div>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize: large?'28px':'20px', color, lineHeight:'1' }}>{value}</div>
      {note && <div style={{ fontFamily:"'EB Garamond',serif", fontSize:'11px', color:T.textMuted, marginTop:'2px', fontStyle:'italic' }}>{note}</div>}
    </div>
  );
}

function SLbl({ children }: { children:React.ReactNode }) {
  return <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'.22em', color:T.textMuted, marginBottom:'12px' }}>{children}</div>;
}

function Opt() {
  return <span style={{ color:T.textMuted, fontStyle:'italic', fontFamily:"'EB Garamond',serif", fontSize:'12px', letterSpacing:0 }}>optional</span>;
}