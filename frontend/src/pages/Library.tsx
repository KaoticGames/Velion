import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import { useAuthStore, selectIsDM } from '@/store/authStore';

// ── Design tokens (mirrors character sheet + compendium) ──────────────────────
const T = {
  bg:        '#080b10',
  surface:   '#0d1018',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  goldDim:   '#6a4212',
  goldFaint: '#c4922a14',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  hp:        '#d45c5c',
  magic:     '#9b6fe8',
  green:     '#50a060',
  dmGold:    '#e8b84b',
};

const RARITY_ORDER = ['Common','Uncommon','Rare','Epic','Legendary','Mythic'];
const RARITY_COLOR: Record<string,string> = {
  Common:'#b0b0c0', Uncommon:'#3dba6a', Rare:'#4a9de8',
  Epic:'#a055e8', Legendary:'#e8a020', Mythic:'#ff5555',
};
const ELEM_COLOR: Record<string,string> = {
  Physical:'#c8b090',
  Fire:'#e87040', Ice:'#60c8e8', Lightning:'#f0d050',
  Poison:'#60c850', Shadow:'#9060c0', Radiant:'#f0e080',
  Arcane:'#a060e8', Nature:'#50a040', Earth:'#c09050', Wind:'#80c8a0',
};
const CLASS_COLOR: Record<string,string> = {
  Minion:'#8a7a68', Standard:'#4a9de8', Elite:'#a055e8', Boss:'#e87040',
};
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : '';
const fmt = (n: number | bigint | string) => Number(n).toLocaleString();

// ── Shared primitives ─────────────────────────────────────────────────────────
const RarityBadge = ({ rarity }: { rarity: string }) => (
  <span style={{
    fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em',
    color: RARITY_COLOR[cap(rarity)] ?? T.textMuted,
    background: (RARITY_COLOR[cap(rarity)] ?? T.textMuted) + '18',
    border: `1px solid ${(RARITY_COLOR[cap(rarity)] ?? T.textMuted)}44`,
    borderRadius:'2px', padding:'2px 7px',
  }}>{rarity.toUpperCase()}</span>
);

const ElemBadge = ({ el }: { el: string }) => (
  <span style={{
    fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
    color: ELEM_COLOR[cap(el)] ?? T.textMuted,
    background: (ELEM_COLOR[cap(el)] ?? T.textMuted) + '18',
    border: `1px solid ${(ELEM_COLOR[cap(el)] ?? T.textMuted)}33`,
    borderRadius:'2px', padding:'2px 7px',
  }}>{el.toUpperCase()}</span>
);

const StatPill = ({ label, value, color = T.textMuted }:
  { label: string; value: string | number; color?: string }) => (
  <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
    background: T.surface, border:`1px solid ${T.border}`, borderRadius:'3px',
    padding:'5px 10px', minWidth:'52px' }}>
    <span style={{ fontFamily:"'Cinzel',serif", fontSize:'8px',
      letterSpacing:'0.16em', color: T.textDim }}>{label}</span>
    <span style={{ fontSize:'16px', fontWeight:'700', color, lineHeight:'1.2',
      marginTop:'2px' }}>{value}</span>
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.22em',
    color: T.textDim, marginBottom:'8px', marginTop:'16px' }}>{children}</div>
);

// ── Filter sidebar primitives ─────────────────────────────────────────────────
const FilterGroup = ({ label, options, value, onChange }:
  { label: string; options: string[]; value: string; onChange: (v: string) => void }) => (
  <div style={{ marginBottom:'20px' }}>
    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.22em',
      color: T.textDim, marginBottom:'8px' }}>{label}</div>
    {['All', ...options].map(opt => (
      <button key={opt} onClick={() => onChange(opt === 'All' ? '' : opt)}
        style={{
          display:'block', width:'100%', textAlign:'left', background:'transparent',
          border:'none', borderLeft: value === (opt === 'All' ? '' : opt)
            ? `2px solid ${T.gold}` : '2px solid transparent',
          padding:'5px 10px', marginBottom:'2px', cursor:'pointer',
          fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.1em',
          color: value === (opt === 'All' ? '' : opt) ? T.gold : T.textMuted,
          transition:'all 0.12s',
        }}
        onMouseEnter={e => { if (value !== (opt === 'All' ? '' : opt)) (e.currentTarget as HTMLButtonElement).style.color = T.text; }}
        onMouseLeave={e => { if (value !== (opt === 'All' ? '' : opt)) (e.currentTarget as HTMLButtonElement).style.color = T.textMuted; }}>
        {opt}
      </button>
    ))}
  </div>
);

// ── Card shell ────────────────────────────────────────────────────────────────
const ItemCard = ({ accentColor = T.gold, onClick, children }:
  { accentColor?: string; onClick: () => void; children: React.ReactNode }) => {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? T.card : T.surface,
        border: `1px solid ${hov ? accentColor + '55' : T.border}`,
        borderTop: `2px solid ${hov ? accentColor : accentColor + '44'}`,
        borderRadius:'3px', padding:'14px 16px', cursor:'pointer',
        transition:'all 0.15s',
      }}>
      {children}
    </div>
  );
};

// ── WEAPONS ───────────────────────────────────────────────────────────────────
function WeaponCard({ w, onClick }: { w: any; onClick: () => void }) {
  const rc = RARITY_COLOR[cap(w.rarity)] ?? T.textMuted;
  return (
    <ItemCard accentColor={rc} onClick={onClick}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px' }}>
        <div style={{ fontSize:'15px', fontWeight:'600', color: T.text, lineHeight:'1.3',
          paddingRight:'8px' }}>{w.name}</div>
        <RarityBadge rarity={cap(w.rarity)} />
      </div>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.16em',
        color: T.textMuted, marginBottom:'10px' }}>{cap(w.category)}</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'5px', marginBottom:'10px' }}>
        {(w.channels ?? []).map((ch: any, i: number) => (
          <span key={i} style={{ fontSize:'13px', fontWeight:'600',
            color: ELEM_COLOR[cap(ch.damage_type)] ?? T.text }}>
            {i > 0 && <span style={{ color: T.textDim, margin:'0 4px' }}>+</span>}
            {ch.num_dice}d{w.base_die_type}
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px',
              color: ELEM_COLOR[cap(ch.damage_type)] ?? T.textMuted,
              marginLeft:'4px', letterSpacing:'0.1em' }}>{ch.damage_type.toUpperCase()}</span>
          </span>
        ))}
      </div>
      <div style={{ display:'flex', gap:'6px', flexWrap:'wrap', fontSize:'11px', color: T.textDim }}>
        {w.gem_slots > 0 && <span style={{ color: T.magic }}>◆ {w.gem_slots} gem slot{w.gem_slots !== 1 ? 's' : ''}</span>}
        {w.req_power > 0 && <span>PWR {w.req_power}+</span>}
        {w.req_agility > 0 && <span>AGI {w.req_agility}+</span>}
        {w.req_focus > 0 && <span>FOC {w.req_focus}+</span>}
      </div>
    </ItemCard>
  );
}

function WeaponDetail({ w, onClose }: { w: any; onClose: () => void }) {
  const rc = RARITY_COLOR[cap(w.rarity)] ?? T.textMuted;
  return (
    <DetailModal accentColor={rc} onClose={onClose}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.3em',
        color: T.textDim, marginBottom:'4px' }}>WEAPON</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', letterSpacing:'0.14em',
        color: rc, margin:'0 0 8px', fontWeight:'700' }}>{w.name}</h2>
      <div style={{ display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap' }}>
        <RarityBadge rarity={cap(w.rarity)} />
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
          color: T.textMuted, border:`1px solid ${T.border}`, borderRadius:'2px',
          padding:'2px 7px' }}>{cap(w.category)}</span>
      </div>
      <SectionLabel>DAMAGE CHANNELS</SectionLabel>
      <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'16px' }}>
        {(w.channels ?? []).map((ch: any, i: number) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:'12px',
            background: T.surface, border:`1px solid ${T.border}`, borderRadius:'3px',
            padding:'10px 14px' }}>
            <span style={{ fontSize:'22px', fontWeight:'700',
              color: ELEM_COLOR[cap(ch.damage_type)] ?? T.text }}>
              {ch.num_dice}d{w.base_die_type}
            </span>
            <div>
              <ElemBadge el={ch.damage_type} />
              <div style={{ fontSize:'11px', color: T.textDim, marginTop:'3px' }}>
                × staked RP = final damage
              </div>
            </div>
          </div>
        ))}
      </div>
      <SectionLabel>PROPERTIES</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="DIE" value={`d${w.base_die_type}`} color={rc} />
        <StatPill label="GEM SLOTS" value={w.gem_slots} color={T.magic} />
        <StatPill label="DICE BUDGET" value={w.total_dice_budget} color={T.gold} />
      </div>
      {(w.req_power > 0 || w.req_agility > 0 || w.req_focus > 0) && (
        <>
          <SectionLabel>REQUIREMENTS</SectionLabel>
          <div style={{ display:'flex', gap:'6px', marginBottom:'16px' }}>
            {w.req_power > 0 && <StatPill label="PWR" value={w.req_power} />}
            {w.req_agility > 0 && <StatPill label="AGI" value={w.req_agility} />}
            {w.req_focus > 0 && <StatPill label="FOC" value={w.req_focus} />}
          </div>
        </>
      )}
      {w.description && (
        <>
          <SectionLabel>DESCRIPTION</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0', fontStyle:'italic' }}>{w.description}</p>
        </>
      )}
    </DetailModal>
  );
}

// ── ARMOR ─────────────────────────────────────────────────────────────────────
const CAT_COLOR: Record<string,string> = { Light:'#50a060', Medium:'#e8a020', Heavy:'#c8503a' };

function ArmorCard({ a, onClick }: { a: any; onClick: () => void }) {
  const rc = RARITY_COLOR[cap(a.rarity)] ?? T.textMuted;
  const cc = CAT_COLOR[cap(a.category)] ?? T.textMuted;
  return (
    <ItemCard accentColor={rc} onClick={onClick}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px' }}>
        <div style={{ fontSize:'15px', fontWeight:'600', color: T.text, paddingRight:'8px' }}>{a.name}</div>
        <RarityBadge rarity={cap(a.rarity)} />
      </div>
      <div style={{ display:'flex', gap:'6px', marginBottom:'10px', flexWrap:'wrap' }}>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
          color: cc, background: cc + '18', border:`1px solid ${cc}33`,
          borderRadius:'2px', padding:'2px 7px' }}>{cap(a.category)}</span>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
          color: T.textMuted, border:`1px solid ${T.border}`,
          borderRadius:'2px', padding:'2px 7px' }}>{cap(a.slot)}</span>
      </div>
      <div style={{ fontSize:'22px', fontWeight:'700', color: rc, marginBottom:'4px' }}>
        {parseFloat(a.mitigation_percent)}%
        <span style={{ fontSize:'11px', fontWeight:'400', color: T.textDim,
          marginLeft:'6px', fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>MITIGATION</span>
      </div>
      <div style={{ fontSize:'11px', color: T.textDim, display:'flex', gap:'8px', flexWrap:'wrap' }}>
        {a.gem_slots > 0 && <span style={{ color: T.magic }}>◆ {a.gem_slots} gem slot{a.gem_slots !== 1 ? 's' : ''}</span>}
        {a.req_power > 0 && <span>PWR {a.req_power}+</span>}
      </div>
    </ItemCard>
  );
}

function ArmorDetail({ a, onClose }: { a: any; onClose: () => void }) {
  const rc = RARITY_COLOR[cap(a.rarity)] ?? T.textMuted;
  const cc = CAT_COLOR[cap(a.category)] ?? T.textMuted;
  return (
    <DetailModal accentColor={rc} onClose={onClose}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.3em',
        color: T.textDim, marginBottom:'4px' }}>ARMOR</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', letterSpacing:'0.14em',
        color: rc, margin:'0 0 8px', fontWeight:'700' }}>{a.name}</h2>
      <div style={{ display:'flex', gap:'8px', marginBottom:'16px', flexWrap:'wrap' }}>
        <RarityBadge rarity={cap(a.rarity)} />
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
          color: cc, background: cc + '18', border:`1px solid ${cc}33`,
          borderRadius:'2px', padding:'2px 7px' }}>{cap(a.category)}</span>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
          color: T.textMuted, border:`1px solid ${T.border}`, borderRadius:'2px',
          padding:'2px 7px' }}>{cap(a.slot)}</span>
      </div>
      <SectionLabel>STATS</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="MITIGATION" value={`${parseFloat(a.mitigation_percent)}%`} color={rc} />
        <StatPill label="GEM SLOTS" value={a.gem_slots} color={T.magic} />
        {a.req_power > 0
          ? <StatPill label="PWR REQ" value={a.req_power} />
          : <StatPill label="PWR REQ" value="—" />}
      </div>
      {a.description && (
        <>
          <SectionLabel>DESCRIPTION</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0', fontStyle:'italic' }}>{a.description}</p>
        </>
      )}
    </DetailModal>
  );
}

// ── SPELL GEMS ────────────────────────────────────────────────────────────────
function GemCard({ g, onClick }: { g: any; onClick: () => void }) {
  const rc = RARITY_COLOR[cap(g.rarity)] ?? T.textMuted;
  const ec = ELEM_COLOR[cap(g.element_type)] ?? T.textMuted;
  return (
    <ItemCard accentColor={ec} onClick={onClick}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px' }}>
        <div style={{ fontSize:'15px', fontWeight:'600', color: T.text, paddingRight:'8px' }}>{g.name}</div>
        <RarityBadge rarity={cap(g.rarity)} />
      </div>
      <div style={{ marginBottom:'10px' }}>
        <ElemBadge el={g.element_type} />
      </div>
      <div style={{ fontSize:'24px', fontWeight:'700', color: ec, lineHeight:'1', marginBottom:'8px' }}>
        {g.num_dice}d{g.die_type}
        <span style={{ fontSize:'12px', fontWeight:'400', color: T.textDim,
          marginLeft:'8px', fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>× RP</span>
      </div>
      {parseFloat(g.armor_resistance_percent) > 0 && (
        <div style={{ fontSize:'11px', color: ec }}>
          {parseFloat(g.armor_resistance_percent)}% elemental resistance
        </div>
      )}
      {g.secondary_effect && (
        <div style={{ fontSize:'11px', color: T.textDim, marginTop:'4px',
          overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {g.secondary_effect}
        </div>
      )}
    </ItemCard>
  );
}

function GemDetail({ g, onClose }: { g: any; onClose: () => void }) {
  const rc = RARITY_COLOR[cap(g.rarity)] ?? T.textMuted;
  const ec = ELEM_COLOR[cap(g.element_type)] ?? T.textMuted;
  return (
    <DetailModal accentColor={ec} onClose={onClose}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.3em',
        color: T.textDim, marginBottom:'4px' }}>SPELL GEM</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', letterSpacing:'0.14em',
        color: ec, margin:'0 0 8px', fontWeight:'700' }}>{g.name}</h2>
      <div style={{ display:'flex', gap:'8px', marginBottom:'16px' }}>
        <RarityBadge rarity={cap(g.rarity)} />
        <ElemBadge el={g.element_type} />
      </div>
      <SectionLabel>DAMAGE</SectionLabel>
      <div style={{ background: T.surface, border:`1px solid ${ec}33`, borderRadius:'3px',
        padding:'14px 18px', marginBottom:'16px', display:'flex', alignItems:'baseline', gap:'12px' }}>
        <span style={{ fontSize:'38px', fontWeight:'700', color: ec }}>{g.num_dice}d{g.die_type}</span>
        <span style={{ fontSize:'16px', color: T.textDim }}>× staked RP</span>
        <span style={{ fontSize:'11px', color: T.textDim, marginLeft:'auto',
          fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>AUTO-HIT</span>
      </div>
      <SectionLabel>PROPERTIES</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="DICE" value={`${g.num_dice}d${g.die_type}`} color={ec} />
        <StatPill label="RESISTANCE" value={`${parseFloat(g.armor_resistance_percent)}%`} color={rc} />
        <StatPill label="ELEMENT" value={cap(g.element_type)} color={ec} />
      </div>
      {g.secondary_effect && (
        <>
          <SectionLabel>SECONDARY EFFECT</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0 0 12px', background: T.surface, border:`1px solid ${T.border}`,
            borderRadius:'3px', padding:'10px 14px' }}>{g.secondary_effect}</p>
        </>
      )}
      {g.description && (
        <>
          <SectionLabel>DESCRIPTION</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0', fontStyle:'italic' }}>{g.description}</p>
        </>
      )}
    </DetailModal>
  );
}

// ── FOCUS BRACERS ─────────────────────────────────────────────────────────────
const GRADE_ORDER = ['initiate','adept','exemplar','ascendant'];
const GRADE_COLOR: Record<string,string> = {
  initiate:'#8a7a68', adept:'#3ab5e8', exemplar:'#9b6fe8', ascendant:'#e8b84b',
};

function BracerCard({ b, onClick }: { b: any; onClick: () => void }) {
  const gc = GRADE_COLOR[b.grade] ?? T.textMuted;
  return (
    <ItemCard accentColor={gc} onClick={onClick}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'8px' }}>
        <div style={{ fontSize:'15px', fontWeight:'600', color: T.text, paddingRight:'8px' }}>{b.name}</div>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em',
          color: gc, background: gc + '18', border:`1px solid ${gc}44`,
          borderRadius:'2px', padding:'2px 7px' }}>{b.grade.toUpperCase()}</span>
      </div>
      <div style={{ fontSize:'28px', fontWeight:'700', color: gc, marginBottom:'4px' }}>
        {b.gem_slots}
        <span style={{ fontSize:'12px', fontWeight:'400', color: T.textDim,
          marginLeft:'6px', fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>GEM SLOTS</span>
      </div>
      {b.req_focus > 0 && (
        <div style={{ fontSize:'11px', color: T.textDim }}>FOC {b.req_focus}+</div>
      )}
    </ItemCard>
  );
}

function BracerDetail({ b, onClose }: { b: any; onClose: () => void }) {
  const gc = GRADE_COLOR[b.grade] ?? T.textMuted;
  return (
    <DetailModal accentColor={gc} onClose={onClose}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.3em',
        color: T.textDim, marginBottom:'4px' }}>FOCUS BRACER</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', letterSpacing:'0.14em',
        color: gc, margin:'0 0 8px', fontWeight:'700' }}>{b.name}</h2>
      <div style={{ display:'flex', gap:'8px', marginBottom:'16px' }}>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em',
          color: gc, background: gc + '18', border:`1px solid ${gc}44`,
          borderRadius:'2px', padding:'2px 7px' }}>{b.grade.toUpperCase()}</span>
      </div>
      <SectionLabel>STATS</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="GEM SLOTS" value={b.gem_slots} color={gc} />
        <StatPill label="FOC REQ" value={b.req_focus > 0 ? b.req_focus : '—'} />
      </div>
      {b.description && (
        <>
          <SectionLabel>DESCRIPTION</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0', fontStyle:'italic' }}>{b.description}</p>
        </>
      )}
    </DetailModal>
  );
}

// ── PETS ──────────────────────────────────────────────────────────────────────
function PetCard({ p, onClick }: { p: any; onClick: () => void }) {
  return (
    <ItemCard accentColor={T.magic} onClick={onClick}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
        <div style={{ fontSize:'15px', fontWeight:'600', color: T.text }}>{p.name}</div>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.14em',
          color: T.magic, background: T.magic + '18', border:`1px solid ${T.magic}33`,
          borderRadius:'2px', padding:'2px 7px' }}>{p.species.toUpperCase()}</span>
      </div>
      <div style={{ display:'flex', gap:'8px', marginBottom:'10px', fontSize:'12px' }}>
        {[['PWR',p.power,'#c8503a'],['AGI',p.agility,'#50a060'],['FOC',p.focus,'#9b6fe8'],['PRE',p.presence,'#c4922a']].map(([l,v,c]) => (
          <div key={l as string} style={{ textAlign:'center' }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color: T.textDim }}>{l}</div>
            <div style={{ fontWeight:'700', color: c as string }}>{v as number}</div>
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:'14px', fontSize:'11px', color: T.textDim }}>
        <span>RP <span style={{ color: T.rp, fontWeight:'600' }}>{p.base_rp}</span></span>
        <span>HP <span style={{ color: T.hp, fontWeight:'600' }}>{fmt(p.max_hp)}</span></span>
        {p.attacks?.length > 0 && (
          <span style={{ color: T.textMuted }}>{p.attacks.length} attack{p.attacks.length !== 1 ? 's' : ''}</span>
        )}
      </div>
    </ItemCard>
  );
}

function PetDetail({ p, onClose }: { p: any; onClose: () => void }) {
  return (
    <DetailModal accentColor={T.magic} onClose={onClose}>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.3em',
        color: T.textDim, marginBottom:'4px' }}>PET / COMPANION</div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', letterSpacing:'0.14em',
        color: T.magic, margin:'0 0 4px', fontWeight:'700' }}>{p.name}</h2>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.18em',
        color: T.textMuted, marginBottom:'16px' }}>{p.species}</div>
      <SectionLabel>ATTRIBUTES</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="PWR" value={p.power} color="#c8503a" />
        <StatPill label="AGI" value={p.agility} color="#50a060" />
        <StatPill label="FOC" value={p.focus} color="#9b6fe8" />
        <StatPill label="PRE" value={p.presence} color="#c4922a" />
      </div>
      <SectionLabel>COMBAT STATS</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="BASE RP" value={p.base_rp} color={T.rp} />
        <StatPill label="MAX HP" value={fmt(p.max_hp)} color={T.hp} />
        <StatPill label="MOVE" value={`${p.movement}ft`} color={T.gold} />
      </div>
      {p.attacks?.length > 0 && (
        <>
          <SectionLabel>ATTACKS</SectionLabel>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'16px' }}>
            {p.attacks.map((atk: any) => (
              <div key={atk.id} style={{ background: T.surface, border:`1px solid ${T.border}`,
                borderRadius:'3px', padding:'10px 14px', display:'flex',
                justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:'14px', fontWeight:'600', color: T.text }}>{atk.name}</div>
                  {atk.description && (
                    <div style={{ fontSize:'11px', color: T.textDim, marginTop:'2px' }}>{atk.description}</div>
                  )}
                </div>
                <div style={{ textAlign:'right', flexShrink:0, marginLeft:'12px' }}>
                  <span style={{ fontSize:'16px', fontWeight:'700',
                    color: ELEM_COLOR[cap(atk.damage_type)] ?? T.text }}>{atk.damage_dice}</span>
                  <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px',
                    letterSpacing:'0.14em', color: T.textDim }}>{atk.damage_type.toUpperCase()}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {p.description && (
        <>
          <SectionLabel>DESCRIPTION</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0', fontStyle:'italic' }}>{p.description}</p>
        </>
      )}
    </DetailModal>
  );
}

// ── ENEMIES (DM only) ─────────────────────────────────────────────────────────
function EnemyCard({ e, onClick }: { e: any; onClick: () => void }) {
  const cc = CLASS_COLOR[cap(e.classification)] ?? T.textMuted;
  return (
    <ItemCard accentColor={cc} onClick={onClick}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'6px' }}>
        <div style={{ fontSize:'15px', fontWeight:'600', color: T.text }}>{e.name}</div>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em',
          color: cc, background: cc + '18', border:`1px solid ${cc}44`,
          borderRadius:'2px', padding:'2px 7px' }}>{e.classification.toUpperCase()}</span>
      </div>
      <div style={{ display:'flex', gap:'14px', marginBottom:'8px', fontSize:'13px' }}>
        <span style={{ color: T.textDim }}>HP <span style={{ color: T.hp, fontWeight:'700' }}>{fmt(e.hp)}</span></span>
        <span style={{ color: T.textDim }}>Res <span style={{ color: cc, fontWeight:'700' }}>+{e.resistance_modifier}</span></span>
        <span style={{ color: T.textDim }}>RP <span style={{ color: T.rp, fontWeight:'700' }}>{e.base_rp}</span></span>
      </div>
      {e.attack_tiers?.length > 0 && (
        <div style={{ display:'flex', gap:'5px', flexWrap:'wrap' }}>
          {e.attack_tiers.map((t: any) => (
            <span key={t.id} style={{ fontFamily:"'Cinzel',serif", fontSize:'9px',
              letterSpacing:'0.12em', color: T.textDim, border:`1px solid ${T.border}`,
              borderRadius:'2px', padding:'2px 7px' }}>
              {cap(t.tier_name)} ×{t.damage_multiplier}
            </span>
          ))}
        </div>
      )}
    </ItemCard>
  );
}

function EnemyDetail({ e, onClose }: { e: any; onClose: () => void }) {
  const cc = CLASS_COLOR[cap(e.classification)] ?? T.textMuted;
  const traits = Array.isArray(e.traits) ? e.traits : [];
  const attacks = Array.isArray(e.attacks) ? e.attacks : [];
  return (
    <DetailModal accentColor={cc} onClose={onClose}>
      <div style={{ display:'flex', gap:'8px', alignItems:'center', marginBottom:'4px' }}>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.3em',
          color: T.textDim }}>ENEMY</div>
        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em',
          color: T.dmGold, background: T.dmGold + '18', border:`1px solid ${T.dmGold}33`,
          borderRadius:'2px', padding:'2px 7px' }}>DM</div>
      </div>
      <h2 style={{ fontFamily:"'Cinzel',serif", fontSize:'22px', letterSpacing:'0.14em',
        color: cc, margin:'0 0 8px', fontWeight:'700' }}>{e.name}</h2>
      <div style={{ display:'flex', gap:'8px', marginBottom:'16px' }}>
        <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.18em',
          color: cc, background: cc + '18', border:`1px solid ${cc}44`,
          borderRadius:'2px', padding:'2px 7px' }}>{e.classification.toUpperCase()}</span>
      </div>
      <SectionLabel>COMBAT STATS</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="HP" value={fmt(e.hp)} color={T.hp} />
        <StatPill label="BASE RP" value={e.base_rp} color={T.rp} />
        <StatPill label="RES MOD" value={`+${e.resistance_modifier}`} color={cc} />
      </div>
      <SectionLabel>ATTRIBUTES</SectionLabel>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px', marginBottom:'16px' }}>
        <StatPill label="PWR" value={e.power} color="#c8503a" />
        <StatPill label="AGI" value={e.agility} color="#50a060" />
        <StatPill label="FOC" value={e.focus} color="#9b6fe8" />
        <StatPill label="PRE" value={e.presence} color="#c4922a" />
      </div>
      {e.attack_tiers?.length > 0 && (
        <>
          <SectionLabel>ATTACK TIERS</SectionLabel>
          <div style={{ display:'flex', flexDirection:'column', gap:'5px', marginBottom:'16px' }}>
            {e.attack_tiers.map((t: any) => (
              <div key={t.id} style={{ background: T.surface, border:`1px solid ${T.border}`,
                borderRadius:'3px', padding:'10px 14px',
                display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <span style={{ fontFamily:"'Cinzel',serif", fontSize:'11px',
                    letterSpacing:'0.14em', color: cc }}>{cap(t.tier_name)}</span>
                  <span style={{ fontSize:'11px', color: T.textDim, marginLeft:'10px' }}>
                    {t.pressure_steps} pressure step{t.pressure_steps !== 1 ? 's' : ''}
                  </span>
                </div>
                <div style={{ textAlign:'right' }}>
                  <span style={{ fontSize:'18px', fontWeight:'700', color: cc }}>×{t.damage_multiplier}</span>
                  {t.max_pool_contribution > 0 && (
                    <div style={{ fontSize:'10px', color: T.textDim }}>pool max +{t.max_pool_contribution}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {attacks.length > 0 && (
        <>
          <SectionLabel>NAMED ATTACKS</SectionLabel>
          <div style={{ display:'flex', flexDirection:'column', gap:'5px', marginBottom:'16px' }}>
            {attacks.map((atk: any, i: number) => (
              <div key={i} style={{ background: T.surface, border:`1px solid ${T.border}`,
                borderRadius:'3px', padding:'10px 14px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
                  <span style={{ fontSize:'13px', fontWeight:'600', color: T.text }}>{atk.name}</span>
                  <span style={{ fontSize:'13px', fontWeight:'700',
                    color: ELEM_COLOR[cap(atk.damage_type)] ?? T.text }}>{atk.damage_dice}</span>
                </div>
                {atk.description && (
                  <div style={{ fontSize:'11px', color: T.textDim }}>{atk.description}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {traits.length > 0 && (
        <>
          <SectionLabel>TRAITS</SectionLabel>
          <div style={{ display:'flex', flexDirection:'column', gap:'5px', marginBottom:'16px' }}>
            {traits.map((tr: any, i: number) => (
              <div key={i} style={{ background: T.surface, border:`1px solid ${T.border}`,
                borderRadius:'3px', padding:'10px 14px' }}>
                <div style={{ fontSize:'13px', fontWeight:'600', color: T.gold,
                  marginBottom:'3px' }}>{tr.name}</div>
                <div style={{ fontSize:'12px', color: T.textMuted }}>{tr.description}</div>
                {tr.mechanic_override && (
                  <div style={{ fontSize:'11px', color: T.rp, marginTop:'4px',
                    fontFamily:"'Cinzel',serif", letterSpacing:'0.06em' }}>{tr.mechanic_override}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {e.description && (
        <>
          <SectionLabel>DESCRIPTION</SectionLabel>
          <p style={{ fontSize:'13px', color: T.textMuted, lineHeight:'1.7',
            margin:'0', fontStyle:'italic' }}>{e.description}</p>
        </>
      )}
    </DetailModal>
  );
}

// ── Detail Modal shell ────────────────────────────────────────────────────────
function DetailModal({ accentColor, onClose, children }:
  { accentColor: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:200,
      background:'#000000bb', display:'flex', alignItems:'center', justifyContent:'center',
      padding:'24px' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: T.card, border:`1px solid ${accentColor}44`,
          borderTop:`3px solid ${accentColor}`, borderRadius:'4px',
          width:'100%', maxWidth:'520px', maxHeight:'85vh',
          overflowY:'auto', padding:'28px 32px', position:'relative' }}>
        <button onClick={onClose}
          style={{ position:'sticky', top:0, float:'right', background:'transparent',
            border:`1px solid ${T.border}`, borderRadius:'2px', color: T.textMuted,
            cursor:'pointer', fontSize:'14px', padding:'2px 10px', marginBottom:'8px',
            fontFamily:"'Cinzel',serif", letterSpacing:'0.12em' }}>✕</button>
        <div style={{ clear:'both' }}>{children}</div>
      </div>
    </div>
  );
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS = [
  { id:'weapons',       label:'Weapons',       color:'#c8503a', dm:false },
  { id:'armor',         label:'Armor',          color:'#e8a020', dm:false },
  { id:'spell-gems',    label:'Spell Gems',     color:'#9b6fe8', dm:false },
  { id:'focus-bracers', label:'Focus Bracers',  color:'#3ab5e8', dm:false },
  { id:'pets',          label:'Pets',           color:'#9b6fe8', dm:false },
  { id:'enemies',       label:'Enemies',        color:'#e87040', dm:true  },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Library() {
  const isDM = useAuthStore(selectIsDM);

  const [tab, setTab]       = useState('weapons');
  const [items, setItems]   = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]  = useState('');
  const [detail, setDetail]  = useState<any>(null);

  // Per-tab filters
  const [filters, setFilters] = useState<Record<string, Record<string,string>>>({
    weapons:        { rarity:'', category:'' },
    armor:          { rarity:'', category:'', slot:'' },
    'spell-gems':   { rarity:'', element:'' },
    'focus-bracers':{ grade:'' },
    pets:           {},
    enemies:        { classification:'' },
  });

  const setFilter = (key: string, val: string) =>
    setFilters(f => ({ ...f, [tab]: { ...f[tab], [key]: val } }));

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string,string> = {};
      const f = filters[tab] ?? {};
      Object.entries(f).forEach(([k,v]) => { if (v) params[k] = v.toLowerCase().replace(/ /g, '_'); });
      if (search) params['name'] = search;
      const qs = new URLSearchParams(params).toString();
      const { data } = await api.get(`/library/${tab}${qs ? '?' + qs : ''}`);
      setItems(data.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, filters, search]);

  // Debounced fetch
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(fetchItems, 250);
    return () => { if (fetchTimer.current) clearTimeout(fetchTimer.current); };
  }, [fetchItems]);

  // Reset search/filters on tab change
  const switchTab = (id: string) => {
    setTab(id);
    setSearch('');
    setItems([]);
    setDetail(null);
  };

  const visibleTabs = TABS.filter(t => isDM || !t.dm);
  const currentTab  = TABS.find(t => t.id === tab);
  const accentColor = currentTab?.color ?? T.gold;

  const sortedItems = [...items].sort((a, b) => {
    if (tab === 'weapons' || tab === 'armor' || tab === 'spell-gems') {
      return RARITY_ORDER.indexOf(cap(a.rarity)) - RARITY_ORDER.indexOf(cap(b.rarity));
    }
    if (tab === 'focus-bracers') {
      return GRADE_ORDER.indexOf(a.grade) - GRADE_ORDER.indexOf(b.grade);
    }
    if (tab === 'enemies') {
      const order = ['Minion','Standard','Elite','Boss'];
      return order.indexOf(cap(a.classification)) - order.indexOf(cap(b.classification));
    }
    return 0;
  });

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 52px)',
      background: T.bg, overflow:'hidden' }}>

      {/* ── Top bar ── */}
      <div style={{ borderBottom:`1px solid ${T.border}`, padding:'20px 32px 0',
        background: T.surface, flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between',
          marginBottom:'16px' }}>
          <div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.3em',
              color: T.textDim, marginBottom:'4px' }}>VELION MYTHERA</div>
            <h1 style={{ fontFamily:"'Cinzel',serif", fontSize:'24px', letterSpacing:'0.16em',
              color: T.gold, margin:'0', fontWeight:'700' }}>Library</h1>
          </div>
          {/* Search */}
          <div style={{ position:'relative', marginBottom:'2px' }}>
            <span style={{ position:'absolute', left:'12px', top:'50%', transform:'translateY(-50%)',
              color: T.textDim, fontSize:'13px', pointerEvents:'none' }}>⌕</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${currentTab?.label?.toLowerCase() ?? ''}…`}
              style={{ background: T.card, border:`1px solid ${T.border}`,
                borderRadius:'3px', padding:'8px 14px 8px 34px', width:'260px',
                color: T.text, fontSize:'13px', outline:'none', fontFamily:'inherit',
                transition:'border-color 0.15s' }}
              onFocus={e => e.currentTarget.style.borderColor = accentColor + '66'}
              onBlur={e => e.currentTarget.style.borderColor = T.border}
            />
          </div>
        </div>
        {/* Tabs */}
        <div style={{ display:'flex', gap:'0' }}>
          {visibleTabs.map(t => (
            <button key={t.id} onClick={() => switchTab(t.id)}
              style={{ background:'transparent', border:'none', borderBottom:
                tab === t.id ? `2px solid ${t.color}` : '2px solid transparent',
                padding:'10px 20px', cursor:'pointer', fontFamily:"'Cinzel',serif",
                fontSize:'11px', letterSpacing:'0.16em',
                color: tab === t.id ? t.color : T.textMuted,
                transition:'all 0.15s', fontWeight: tab === t.id ? '600' : '400',
                display:'flex', alignItems:'center', gap:'8px' }}>
              {t.label}
              {t.dm && <span style={{ fontFamily:"'Cinzel',serif", fontSize:'8px',
                letterSpacing:'0.18em', color: T.dmGold,
                border:`1px solid ${T.dmGold}44`, borderRadius:'2px',
                padding:'1px 5px' }}>DM</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── Filter sidebar ── */}
        <div style={{ width:'180px', flexShrink:0, borderRight:`1px solid ${T.border}`,
          overflowY:'auto', padding:'20px 16px', background: T.surface }}>

          {tab === 'weapons' && (
            <>
              <FilterGroup label="RARITY" options={RARITY_ORDER}
                value={filters.weapons.rarity} onChange={v => setFilter('rarity', v)} />
              <FilterGroup label="CATEGORY"
                options={['Short Sword','Long Sword','Great Axe','Warhammer','Bow','Staff','Dagger']}
                value={filters.weapons.category} onChange={v => setFilter('category', v)} />
            </>
          )}
          {tab === 'armor' && (
            <>
              <FilterGroup label="RARITY" options={RARITY_ORDER}
                value={filters.armor.rarity} onChange={v => setFilter('rarity', v)} />
              <FilterGroup label="CATEGORY" options={['Light','Medium','Heavy']}
                value={filters.armor.category} onChange={v => setFilter('category', v)} />
              <FilterGroup label="SLOT"
                options={['Helmet','Chestplate','Leggings','Gauntlets','Boots','Shirt','Pants']}
                value={filters.armor.slot} onChange={v => setFilter('slot', v)} />
            </>
          )}
          {tab === 'spell-gems' && (
            <>
              <FilterGroup label="RARITY" options={RARITY_ORDER}
                value={filters['spell-gems'].rarity} onChange={v => setFilter('rarity', v)} />
              <FilterGroup label="ELEMENT"
                options={['Fire','Ice','Lightning','Poison','Shadow','Radiant','Arcane','Nature','Earth','Wind']}
                value={filters['spell-gems'].element} onChange={v => setFilter('element', v)} />
            </>
          )}
          {tab === 'focus-bracers' && (
            <FilterGroup label="GRADE" options={['Initiate','Adept','Exemplar','Ascendant']}
              value={filters['focus-bracers'].grade} onChange={v => setFilter('grade', v.toLowerCase())} />
          )}
          {tab === 'pets' && (
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.16em',
              color: T.textDim, lineHeight:'1.7' }}>
              Search by name or species using the search bar above.
            </div>
          )}
          {tab === 'enemies' && (
            <FilterGroup label="CLASSIFICATION" options={['Minion','Standard','Elite','Boss']}
              value={filters.enemies.classification}
              onChange={v => setFilter('classification', v.toLowerCase())} />
          )}
        </div>

        {/* ── Card grid ── */}
        <div style={{ flex:1, overflowY:'auto', padding:'24px 28px' }}>

          {/* Count + state label */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            marginBottom:'18px' }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.2em',
              color: T.textDim }}>
              {loading ? 'LOADING…'
                : sortedItems.length === 0 ? 'NO RESULTS'
                : `${sortedItems.length} ${sortedItems.length === 1 ? currentTab?.label?.slice(0,-1) ?? 'ITEM' : currentTab?.label?.toUpperCase() ?? 'ITEMS'}`}
            </div>
            {!loading && sortedItems.length > 0 && (
              <div style={{ fontSize:'11px', color: T.textDim }}>
                Click any card for full details
              </div>
            )}
          </div>

          {/* Loading shimmer */}
          {loading && (
            <div style={{ display:'grid',
              gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'12px' }}>
              {Array.from({length:6}).map((_,i) => (
                <div key={i} style={{ background: T.surface, border:`1px solid ${T.border}`,
                  borderRadius:'3px', height:'110px',
                  animation:`pulse 1.4s ease-in-out ${i*0.1}s infinite alternate` }} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && sortedItems.length === 0 && (
            <div style={{ textAlign:'center', padding:'60px 20px' }}>
              <div style={{ fontSize:'40px', marginBottom:'16px', opacity:0.3 }}>◈</div>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:'13px', letterSpacing:'0.2em',
                color: T.textDim }}>
                {search ? 'No results for your search' : `No ${currentTab?.label?.toLowerCase() ?? 'items'} found`}
              </div>
              {search && (
                <button onClick={() => setSearch('')}
                  style={{ marginTop:'12px', background:'transparent',
                    border:`1px solid ${T.border}`, borderRadius:'3px',
                    padding:'6px 16px', color: T.textMuted, cursor:'pointer',
                    fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.14em' }}>
                  CLEAR SEARCH
                </button>
              )}
            </div>
          )}

          {/* Cards */}
          {!loading && sortedItems.length > 0 && (
            <div style={{ display:'grid',
              gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:'12px' }}>
              {sortedItems.map(item => {
                const key = item.id;
                if (tab === 'weapons')        return <WeaponCard  key={key} w={item} onClick={() => setDetail(item)} />;
                if (tab === 'armor')          return <ArmorCard   key={key} a={item} onClick={() => setDetail(item)} />;
                if (tab === 'spell-gems')     return <GemCard     key={key} g={item} onClick={() => setDetail(item)} />;
                if (tab === 'focus-bracers')  return <BracerCard  key={key} b={item} onClick={() => setDetail(item)} />;
                if (tab === 'pets')           return <PetCard     key={key} p={item} onClick={() => setDetail(item)} />;
                if (tab === 'enemies')        return <EnemyCard   key={key} e={item} onClick={() => setDetail(item)} />;
                return null;
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail modal ── */}
      {detail && tab === 'weapons'       && <WeaponDetail  w={detail} onClose={() => setDetail(null)} />}
      {detail && tab === 'armor'         && <ArmorDetail   a={detail} onClose={() => setDetail(null)} />}
      {detail && tab === 'spell-gems'    && <GemDetail     g={detail} onClose={() => setDetail(null)} />}
      {detail && tab === 'focus-bracers' && <BracerDetail  b={detail} onClose={() => setDetail(null)} />}
      {detail && tab === 'pets'          && <PetDetail     p={detail} onClose={() => setDetail(null)} />}
      {detail && tab === 'enemies'       && <EnemyDetail   e={detail} onClose={() => setDetail(null)} />}

      <style>{`@keyframes pulse { from { opacity: 0.4 } to { opacity: 0.8 } }`}</style>
    </div>
  );
}