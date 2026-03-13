import { useState, useEffect, useRef } from 'react';
import { useAuthStore, selectIsDM } from '@/store/authStore';

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  bg:       '#080b10',
  surface:  '#0d1018',
  card:     '#111520',
  border:   '#1c2230',
  gold:     '#c4922a',
  goldDim:  '#6a4212',
  goldFaint:'#c4922a14',
  text:     '#e4d8c0',
  textMuted:'#8a7a68',
  textDim:  '#504538',
  rp:       '#3ab5e8',
  rpDim:    '#1a4a5e',
  hp:       '#d45c5c',
  magic:    '#9b6fe8',
  magicDim: '#3a2060',
  green:    '#50a060',
  dmGold:   '#e8b84b',
};

// ── Shared micro-components ───────────────────────────────────────────────────
const Formula = ({ children }: { children: string }) => (
  <div style={{
    fontFamily: "'Courier New', monospace", fontSize: '15px', color: T.rp,
    background: T.rpDim + '44', border: `1px solid ${T.rp}33`,
    borderRadius: '3px', padding: '8px 14px', margin: '10px 0',
    letterSpacing: '0.04em',
  }}>{children}</div>
);

const Table = ({ headers, rows, accentCol = 0 }: { headers: string[], rows: string[][], accentCol?: number }) => (
  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', marginBottom: '12px' }}>
    <thead>
      <tr>{headers.map(h => (
        <th key={h} style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
          color: T.textMuted, borderBottom: `1px solid ${T.border}`, padding: '7px 10px', textAlign: 'left' }}>{h}</th>
      ))}</tr>
    </thead>
    <tbody>{rows.map((row, i) => (
      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff06' }}>
        {row.map((cell, j) => (
          <td key={j} style={{
            padding: '6px 10px', borderBottom: `1px solid ${T.border}22`,
            color: j === accentCol ? T.gold : T.text, fontWeight: j === accentCol ? '500' : 'normal',
          }}>{cell}</td>
        ))}
      </tr>
    ))}</tbody>
  </table>
);

const Callout = ({ color = T.gold, label, children }: { color?: string, label: string, children: React.ReactNode }) => (
  <div style={{ border: `1px solid ${color}44`, borderLeft: `3px solid ${color}`, borderRadius: '3px',
    background: color + '0a', padding: '12px 14px', margin: '14px 0' }}>
    <div style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.18em', color, marginBottom: '6px' }}>{label}</div>
    <div style={{ fontSize: '15px', color: T.text, lineHeight: '1.7' }}>{children}</div>
  </div>
);

const DMBadge = () => (
  <span style={{ fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.2em',
    color: T.dmGold, background: T.dmGold + '18', border: `1px solid ${T.dmGold}44`,
    borderRadius: '3px', padding: '2px 7px', marginLeft: '10px', verticalAlign: 'middle' }}>DM ONLY</span>
);

const SectionHead = ({ id, title, dmOnly = false }: { id: string, title: string, dmOnly?: boolean }) => (
  <div id={id} style={{ paddingTop: '6px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
      <div style={{ height: '1px', flex: 1, background: `linear-gradient(to right, ${T.goldDim}, transparent)` }} />
    </div>
    <h2 style={{ fontFamily: "'Cinzel',serif", fontSize: '18px', letterSpacing: '0.22em',
      color: dmOnly ? T.dmGold : T.gold, margin: '0 0 4px', fontWeight: '600' }}>
      {title}{dmOnly && <DMBadge />}
    </h2>
  </div>
);

const SubHead = ({ children }: { children: React.ReactNode }) => (
  <h3 style={{ fontFamily: "'Cinzel',serif", fontSize: '14px', letterSpacing: '0.18em',
    color: T.textMuted, margin: '22px 0 10px', fontWeight: '600', textTransform: 'uppercase' }}>{children}</h3>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: '16px', color: T.text, lineHeight: '1.8', margin: '0 0 12px' }}>{children}</p>
);

const StateBadge = ({ name, cat, color, effect }: { name: string, cat: string, color: string, effect: string }) => (
  <div style={{ background: T.card, border: `1px solid ${color}33`, borderTop: `2px solid ${color}`,
    borderRadius: '3px', padding: '10px 12px', marginBottom: '8px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
      <span style={{ fontFamily: "'Cinzel',serif", fontSize: '14px', color, fontWeight: '600' }}>{name}</span>
      <span style={{ fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.16em', color: T.textMuted }}>{cat}</span>
    </div>
    <div style={{ fontSize: '15px', color: T.textMuted, lineHeight: '1.6' }}>{effect}</div>
  </div>
);

// ── Nav sections ──────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'formulas',        label: 'Core Formulas',        dm: false },
  { id: 'attributes',      label: 'Attributes',           dm: false },
  { id: 'rp',              label: 'Resource Points',      dm: false },
  { id: 'combat',          label: 'Combat Structure',     dm: false },
  { id: 'pressure',        label: 'Pressure Steps',       dm: false },
  { id: 'damage',          label: 'Damage & Mitigation',  dm: false },
  { id: 'magic',           label: 'Magic / Spell Gems',   dm: false },
  { id: 'states',          label: 'State System',         dm: false },
  { id: 'overextension',   label: 'Overextension',        dm: false },
  { id: 'healing',         label: 'Healing, Rest & Death',dm: false },
  { id: 'ooc',             label: 'Out-of-Combat',        dm: false },
  { id: 'creation',        label: 'Character Creation',   dm: false },
  { id: 'enemies',         label: 'Enemy System',         dm: true  },
  { id: 'encounter',       label: 'Encounter Pool',       dm: true  },
];

// ── State data ────────────────────────────────────────────────────────────────
const STATES = [
  { name: 'Stunned',      cat: 'CONTROL',              color: '#d45c5c',
    effect: 'No Pressure or Defensive Steps. Auto 5 Net Steps vs target. Ends next turn.' },
  { name: 'Restrained',   cat: 'CONTROL',              color: '#d45c5c',
    effect: 'Pressure & Defensive Steps −2. No banking. Restricted movement.' },
  { name: 'Grappled',     cat: 'CONTROL',              color: '#d45c5c',
    effect: 'Steps normal. No target change without extra RP. Limited movement.' },
  { name: 'Silenced',     cat: 'CONTROL',              color: '#d45c5c',
    effect: 'No Focus-based abilities or spell Pressure Steps. Physical attacks unaffected.' },
  { name: 'Exhausted',    cat: 'CAPACITY',             color: '#c4922a',
    effect: 'Base RP −25%. No banking. Defensive Steps capped at 2.' },
  { name: 'Suppressed',   cat: 'CAPACITY',             color: '#c4922a',
    effect: 'Pressure Steps capped at 2. Defensive Steps normal.' },
  { name: 'Overextended', cat: 'CAPACITY — SEVERE',    color: '#e8384a',
    effect: 'Base RP −50%. No banking. No reactions. All Steps ≤2. Disadvantage saves. +Vulnerable. Until Long Rest.' },
  { name: 'Burned',       cat: 'DAMAGE',               color: '#e8703a',
    effect: 'Recurring % damage each turn. Defensive Steps ≤3. Ends with countermeasure action.' },
  { name: 'Poisoned',     cat: 'DAMAGE',               color: '#5ab050',
    effect: 'Steps ≤3 both. Disadvantage saves if 0 Defensive Steps.' },
  { name: 'Bleeding',     cat: 'DAMAGE',               color: '#c85050',
    effect: 'Minor HP loss per turn. Ends when healed above severity threshold.' },
  { name: 'Charmed',      cat: 'ALTERED',              color: '#9b6fe8',
    effect: 'Cannot target charm source. Defensive Steps −2 vs source.' },
  { name: 'Frightened',   cat: 'ALTERED',              color: '#9b6fe8',
    effect: 'Pressure ≤2 vs fear source. Defensive Steps +1 vs source.' },
  { name: 'Asleep',       cat: 'ALTERED',              color: '#9b6fe8',
    effect: 'Cannot act. Auto 5 Net Steps against target. Ends on damage.' },
  { name: 'Vulnerable',   cat: 'STRUCTURAL',           color: '#3ab5e8',
    effect: 'Armor mitigation −50%. Elemental resistance −50%.' },
  { name: 'Fortified',    cat: 'STRUCTURAL',           color: '#3ab5e8',
    effect: 'Armor +10%. Minimum 1 Defensive Step always, even with 0 RP committed.' },
  { name: 'Enraged',      cat: 'STRUCTURAL',           color: '#3ab5e8',
    effect: 'Pressure Steps ≤6 (cap +1). No Defensive Steps. No banking.' },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Compendium() {
  const isDM = useAuthStore(selectIsDM);
  const [active, setActive] = useState('formulas');
  const contentRef = useRef<HTMLDivElement>(null);

  // Scrollspy
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = () => {
      const scrollY = el.scrollTop;
      for (const sec of [...SECTIONS].reverse()) {
        if (!isDM && sec.dm) continue;
        const node = document.getElementById(sec.id);
        if (node && node.offsetTop - 120 <= scrollY) { setActive(sec.id); break; }
      }
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [isDM]);

  const scrollTo = (id: string) => {
    const node = document.getElementById(id);
    const el = contentRef.current;
    if (node && el) el.scrollTo({ top: node.offsetTop - 80, behavior: 'smooth' });
    setActive(id);
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 52px)', background: T.bg, overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <div style={{ width: '220px', flexShrink: 0, borderRight: `1px solid ${T.border}`,
        overflowY: 'auto', padding: '24px 0', background: T.surface }}>
        <div style={{ padding: '0 20px 16px', fontFamily: "'Cinzel',serif", fontSize: '11px',
          letterSpacing: '0.3em', color: T.textDim }}>COMPENDIUM</div>

        {SECTIONS.filter(s => isDM || !s.dm).map(sec => (
          <button key={sec.id} onClick={() => scrollTo(sec.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '8px 20px', background: active === sec.id ? T.goldFaint : 'transparent',
              border: 'none', borderLeft: active === sec.id ? `2px solid ${sec.dm ? T.dmGold : T.gold}` : '2px solid transparent',
              color: active === sec.id ? (sec.dm ? T.dmGold : T.gold) : sec.dm ? '#a07830' : T.textMuted,
              fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.12em',
              cursor: 'pointer', transition: 'all 0.15s',
            }}>
            {sec.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '40px 52px' }}>
        <div style={{ maxWidth: '820px' }}>

          {/* Page header */}
          <div style={{ marginBottom: '40px' }}>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.3em',
              color: T.textDim, marginBottom: '6px' }}>VELION MYTHERA</div>
            <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: '32px', letterSpacing: '0.16em',
              color: T.gold, margin: '0 0 10px', fontWeight: '700' }}>Compendium</h1>
            <p style={{ fontSize: '16px', color: T.textMuted, lineHeight: '1.7', maxWidth: '560px' }}>
              A guide to the mechanics of Velion Mythera. The system exists to serve the story —
              not the other way around. Every number here is a starting point, not a ceiling.
            </p>
            {isDM && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginTop: '12px',
                background: T.dmGold + '14', border: `1px solid ${T.dmGold}33`,
                borderRadius: '3px', padding: '6px 14px' }}>
                <span style={{ color: T.dmGold, fontSize: '14px' }}>⚔</span>
                <span style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.15em',
                  color: T.dmGold }}>DM VIEW — enemy system and encounter pool sections visible</span>
              </div>
            )}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              CORE FORMULAS
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="formulas" title="Core Formulas" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', margin: '18px 0 28px' }}>
            {[
              ['Attribute Modifier',   '(Attribute − 10) ÷ 2'],
              ['Base RP',              'Level + Chosen Attr Modifier + Growth Pool'],
              ['Max HP',               'Base RP × (Level + 10)²'],
              ['Net Steps',            'Pressure Steps − Defensive Steps  [0–5]'],
              ['Save Target',          '10 + (2 × Net Steps)  [10–20]'],
              ['Physical Damage',      'Weapon Dice per Channel × Staked RP'],
              ['Spell Damage',         'Gem Dice per Channel × Staked RP'],
              ['Final Physical',       'Incoming Physical × (1 − Mitigation%)'],
              ['Final Elemental',      'Incoming Elemental × (1 − Resistance%)'],
              ['Elemental Healing',    'Incoming Elemental × (Resistance% − 100%)'],
              ['Overextension DC',     '10 + (10 × OE ÷ A)  [10–20]'],
              ['Combat Healing',       'Healing Dice × Staked RP'],
            ].map(([label, formula]) => (
              <div key={label} style={{ background: T.card, border: `1px solid ${T.border}`,
                borderRadius: '3px', padding: '12px 14px' }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.16em',
                  color: T.textMuted, marginBottom: '6px' }}>{label}</div>
                <code style={{ fontSize: '14px', color: T.rp, fontFamily: "'Courier New', monospace" }}>{formula}</code>
              </div>
            ))}
          </div>

          {/* ══════════════════════════════════════════════════════════════════
              ATTRIBUTES
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="attributes" title="Attributes" />
          <P>Every character is defined by four attributes. No secondary stats, no skill trees — all capability routes through these four pillars.</P>
          <Table
            headers={['Attribute', 'Governs', 'Primary Use']}
            rows={[
              ['Power',    'Physical strength, endurance, raw force',     'Heavy weapons & armor access, grapple, endurance checks'],
              ['Agility',  'Reflex, coordination, precision',              'Defensive saves, stealth, lockpicking, traversal'],
              ['Focus',    'Mental clarity, arcane discipline, perception','Spell Gem access, knowledge recalls, perception, investigation'],
              ['Presence', 'Charisma, social pressure, command authority', 'Persuasion, intimidation, deception, rallying allies'],
            ]}
          />
          <SubHead>Generation</SubHead>
          <P>Roll <strong style={{color:T.gold}}>3d20</strong> per attribute, sum the three results, divide by 3, round down. Free assignment of four values to four attributes. The Mulligan Rule: re-rolling discards all four values simultaneously — no selective re-rolls.</P>
          <Formula>Modifier = (Attribute − 10) ÷ 2</Formula>
          <SubHead>Growth & Leveling</SubHead>
          <P>Each level grants <strong style={{color:T.gold}}>+2 Attribute Points</strong>, maximum +1 per attribute per level. No cap on how high attributes can grow. The Chosen Attribute determines which modifier feeds into Base RP and may be changed at each level-up.</P>
          <SubHead>Emergent Archetypes</SubHead>
          <Table
            headers={['Build', 'Archetype', 'Identity']}
            rows={[
              ['High Power + Heavy Armor',     'Juggernaut',       'Immovable, devastating, built to endure'],
              ['High Agility + Light Armor',   'Avoidance Duelist','Evasive, precise — lives by the save'],
              ['High Focus + Elemental Gear',  'Arcane Striker',   'Magical force amplified through steel'],
              ['High Presence + Social Tools', 'Commander',        'Reshapes the battlefield through authority'],
            ]}
          />

          {/* ══════════════════════════════════════════════════════════════════
              RESOURCE POINTS
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="rp" title="Resource Points" />
          <P>RP is the heartbeat of Velion Mythera — a unified combat currency that replaces all action types, spell slots, and initiative advantages. RP represents committed effort, not stamina or mana.</P>
          <Formula>Base RP = Level + Chosen Attribute Modifier + Growth Pool</Formula>
          <SubHead>Turn Reset</SubHead>
          <Callout color={T.rp} label="RP TURN RESET">
            1. RP resets to Base RP at the Start Phase.<br/>
            2. Add any banked RP from the previous turn.<br/>
            3. Total RP cannot exceed <strong>2 × Base RP</strong>.
          </Callout>
          <SubHead>Spending</SubHead>
          <P>Every meaningful action costs at least 1 RP. Additional RP committed beyond the minimum scales the action's magnitude, damage, and Pressure directly.</P>
          <P>RP may be spent to generate Pressure Steps, generate Defensive Steps, multiply damage (staked RP = damage multiplier), execute additional actions, cast spells, or perform movement-based actions.</P>
          <P><strong style={{color:T.hp}}>RP cannot</strong> add flat bonuses to d20 rolls, reduce damage after it is dealt, or increase armor mitigation or elemental resistance.</P>
          <SubHead>Banking</SubHead>
          <P>If fewer than half of available RP are spent before the End Phase, banking may be declared. Banked RP carries into the next turn (up to Base RP worth). <strong style={{color:T.hp}}>Banked RP is unavailable for reactions</strong> — banking is an offensive choice, not a defensive one.</P>
          <SubHead>Growth Pool</SubHead>
          <P>At every level-up, roll 1d6 and permanently add the result. The Growth Pool contribution prevents attribute-stacking from being the only viable optimization path. By level 20, the pool averages ~70 points.</P>

          {/* ══════════════════════════════════════════════════════════════════
              COMBAT STRUCTURE
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="combat" title="Combat Structure" />
          <P>Combat uses alternating side turns — no initiative rolls. The Player Side acts fully, then the Enemy Side acts fully. First-mover advantage is determined narratively by the DM.</P>
          <SubHead>The Four Phases</SubHead>
          {[
            { ph: 'A. START PHASE', color: T.rp,
              body: 'RP resets to Base RP. Banked RP is added. Total capped at 2× Base RP. Active state effects are checked and applied.' },
            { ph: 'B. DECLARATION PHASE', color: T.gold,
              body: 'Declare target, committed RP, Pressure generated, and Overextension if applicable. No dice yet. Strategy lives here.' },
            { ph: 'C. RESOLUTION PHASE', color: T.magic,
              body: 'Pressure Steps → Defensive Steps → Net Steps → Save Target → Save Roll → Critical Check (if save fails) → Damage.' },
            { ph: 'D. END PHASE', color: T.green,
              body: 'Remaining RP may be held for reactions (available until next turn) or declared banked (carries forward, unavailable for reactions).' },
          ].map(({ ph, color, body }) => (
            <div key={ph} style={{ borderLeft: `3px solid ${color}`, paddingLeft: '14px', marginBottom: '14px' }}>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.15em', color, marginBottom: '4px' }}>{ph}</div>
              <div style={{ fontSize: '15px', color: T.text, lineHeight: '1.7' }}>{body}</div>
            </div>
          ))}
          <SubHead>Critical System</SubHead>
          <Callout color={T.hp} label="DEFENSIVE CRITICAL — Natural 20 on Save">
            Attack fails completely. Attacker's turn ends. All remaining RP lost. Banking unavailable. Defender may immediately counterattack.
          </Callout>
          <Callout color={T.gold} label="OFFENSIVE CRITICAL — Natural 20 on Critical Check (after failed save)">
            Final damage doubled across all channels. Doubling occurs after RP scaling and all mitigation. Criticals cannot be stacked or fished.
          </Callout>

          {/* ══════════════════════════════════════════════════════════════════
              PRESSURE STEPS
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="pressure" title="Pressure Step System" />
          <P>Accuracy is tier-based, not a raw modifier. RP converts to Pressure Steps (max 5) via percentage thresholds — keeping hit probability bounded between 5% and 95% regardless of power level.</P>
          <Table
            headers={['RP Committed (%)', 'Steps Generated']}
            rows={[
              ['0%',      '0 Steps'],
              ['1–20%',   '1 Step'],
              ['21–40%',  '2 Steps'],
              ['41–60%',  '3 Steps'],
              ['61–80%',  '4 Steps'],
              ['81–100%', '5 Steps (maximum)'],
            ]}
          />
          <SubHead>Resolution Sequence</SubHead>
          <Formula>Net Steps = Pressure Steps − Defensive Steps   [Min: 0, Max: 5]</Formula>
          <Formula>Save Target = 10 + (2 × Net Steps)   [Range: 10–20]</Formula>
          <P>The defender rolls <strong style={{color:T.rp}}>d20 + Resistance Modifier</strong>. If the total meets or exceeds the Save Target, the attack is avoided. On a failed save, the attacker rolls a Critical Check (1d20 — nat 20 = double damage).</P>
          <SubHead>Defensive Steps</SubHead>
          <P>Player defenders may generate Defensive Steps by committing RP using the same percentage table. Each Defensive Step subtracts directly from incoming Pressure Steps before the Save Target is set. A player who spends defensively must sacrifice offensive output.</P>
          <Callout color={T.text} label="STABILITY GUARANTEE">
            Hit chance always bounded 5%–95%. Maximum Pressure Steps never exceeds 5. Save Target range locked at 10–20. No additive modifier stacking arms race. System functions identically from level 1 to level 100.
          </Callout>
          <SubHead>Enemy Resistance Modifiers</SubHead>
          <Table
            headers={['Enemy Tier', 'Resistance Modifier']}
            rows={[
              ['Minion',   '+0 to +1'],
              ['Standard', '+2 to +3'],
              ['Elite',    '+3 to +4'],
              ['Boss',     '+4 to +5'],
            ]}
          />

          {/* ══════════════════════════════════════════════════════════════════
              DAMAGE & MITIGATION
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="damage" title="Damage & Mitigation" />
          <Formula>Damage = (Weapon Dice per Channel) × Staked RP</Formula>
          <P>Every channel is multiplied by the <em>full</em> staked RP amount independently — no splitting. Staking 100 RP into a multi-channel weapon multiplies both channels by 100.</P>
          <SubHead>Weapon Rarity — Dice Budget</SubHead>
          <P>Rarity sets a <strong style={{color:T.gold}}>minimum</strong> dice count for a weapon of that tier — not a hard ceiling. The DM may approve higher counts where the narrative calls for it. These numbers are a guide, not a constraint.</P>
          <Table
            headers={['Rarity', 'Minimum Dice', 'Short Sword Baseline']}
            rows={[
              ['Common',     '1 die', '1d6'],
              ['Uncommon',   '2 dice','2d6'],
              ['Rare',       '3 dice','3d6'],
              ['Epic',       '4 dice','4d6'],
              ['Legendary',  '5 dice','5d6'],
              ['Mythic',     '6 dice','6d6'],
            ]}
          />
          <SubHead>Multi-Channel Weapons</SubHead>
          <P>A weapon may split its dice across physical and elemental channels. As a baseline, the dice budget is divided rather than expanded — but the DM may approve a larger total budget for multi-channel weapons where the story supports it. A legendary blade that deals both slashing and fire is not inherently weaker than a single-channel equivalent; the DM decides what makes sense for the weapon and the world.</P>
          <Formula>Damage = (Physical Dice × RP) + (Elemental Dice × RP)</Formula>
          <SubHead>Armor Mitigation</SubHead>
          <P>Percentage-based and additive across all equipped pieces. Applies only to physical damage channels, after all dice rolls and RP multiplication.</P>
          <Formula>Final Physical Damage = Incoming Physical × (1 − Mitigation%)</Formula>
          <P>Soft cap recommendation: 60% total mitigation. No hard rule, but the DM may warn if exceeded.</P>
          <Table
            headers={['Armor Slot', 'Coverage']}
            rows={[
              ['Helmet',              'Head'],
              ['Chestplate',          'Torso — typically highest mitigation'],
              ['Leggings',            'Lower body'],
              ['Gauntlets / Gloves',  'Hands and forearms'],
              ['Boots',               'Feet and lower legs'],
              ['Shirt / Underpadding','Light base layer'],
              ['Pants / Cuisses',     'Secondary leg coverage'],
            ]}
          />
          <SubHead>Elemental Resistance</SubHead>
          <P>Applies independently to each elemental channel after physical mitigation. Percentage-based for the same reason armor mitigation is — flat reduction is meaningless at Velion's damage scale.</P>
          <Formula>Final Elemental Damage = Incoming Elemental × (1 − Resistance%)</Formula>
          <Callout color={T.magic} label="OVER-100% RESISTANCE — ABSORPTION">
            When resistance exceeds 100%, incoming damage of that type is fully negated. The excess converts to healing:<br/>
            <strong>Healing = Incoming Elemental × (Resistance% − 100%)</strong>
          </Callout>
          <P>Damage resolution order: (1) Roll channel dice. (2) Multiply each by staked RP. (3) Apply armor mitigation to physical channel only. (4) Apply elemental resistance to each elemental channel independently. (5) Sum all finals and subtract from HP.</P>

          {/* ══════════════════════════════════════════════════════════════════
              MAGIC
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="magic" title="Magic — Spell Gem System" />
          <P>Magic does not use memorized spells or daily slots. It is crystallized in Spell Gems channeled through Focus Bracers worn on the wrists. The defining feature of magic: <strong style={{color:T.magic}}>it automatically hits</strong>. No Pressure Steps are generated. No defensive save applies. Only elemental resistance can reduce it.</P>
          <Formula>Spell Damage = (Gem Dice per Channel) × Staked RP</Formula>
          <SubHead>Focus Bracers</SubHead>
          <Table
            headers={['Bracer Grade', 'Active Gem Slots', 'Focus Required']}
            rows={[
              ['Initiate',   '2 slots', 'Low'],
              ['Adept',      '4 slots', 'Moderate'],
              ['Exemplar',   '6 slots', 'High'],
              ['Ascendant',  '8 slots', 'Exceptional'],
            ]}
          />
          <SubHead>Spell Gem Rarity</SubHead>
          <P>The damage dice listed below are <strong style={{color:T.gold}}>minimum recommendations</strong> for each rarity tier — the DM may approve higher counts at any rarity. What truly separates a Rare gem from a Mythic one is not raw damage potential alone, but the <em>scale and nature of its effects</em>.</P>
          <P>A Rare fire gem with 5d6 is devastating in the hands of a committed spellcaster — but it still behaves like fire. It burns what it touches. A Mythic fire gem may incinerate a city block, ignite the air itself, or leave a crater that smoulders for days. The difference is not just numbers: it is what the gem does to the world around it.</P>
          <Table
            headers={['Rarity', 'Min. Damage Dice', 'Scale of Effect']}
            rows={[
              ['Common',    '1d6 / gem', 'Basic elemental expression — contained, reliable'],
              ['Uncommon',  '1d6 / gem', 'Minor secondary effect possible'],
              ['Rare',      '2d6 / gem', 'Meaningful secondary effects — starts fires, leaves marks'],
              ['Epic',      '3d6 / gem', 'Significant environmental impact, strong resistance values'],
              ['Legendary', '4d6 / gem', 'Major abilities — reshapes encounters'],
              ['Mythic',    '5d6+ / gem','Reality-altering — the world is changed by its use'],
            ]}
          />
          <SubHead>Critical Checks for Magic</SubHead>
          <P>After calculating spell damage, roll 1d20. A natural 20 doubles the final damage total. A natural 1 may trigger a critical failure at DM discretion. The critical check is the only roll a spellcaster makes — hit chance is guaranteed.</P>
          <SubHead>Weapon Gem Slots</SubHead>
          <P>Spell Gems can be embedded directly into weapons, adding elemental channels to physical attacks. Gem slot count scales with weapon rarity. Smithing a new slot into a weapon increases its rarity tier and attribute prerequisites.</P>
          <Table
            headers={['Weapon Rarity', 'Gem Slots']}
            rows={[
              ['Common', '0'], ['Uncommon','1'], ['Rare','2'],
              ['Epic','3'], ['Legendary','4'], ['Mythic','5+'],
            ]}
          />
          <SubHead>Strategic Distinction: Magic vs Physical</SubHead>
          <P>Physical attacks can be avoided with a high defensive save. Magical damage cannot be avoided — only elemental resistance counters it. This creates fundamentally different build requirements for both offense and defense.</P>

          {/* ══════════════════════════════════════════════════════════════════
              STATES
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="states" title="State System" />
          <P>States are disruptions to the RP economy — not flat numerical penalties. Because RP drives all combat expression, states that limit RP access or efficiency create meaningful tactical consequences.</P>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            {STATES.map(s => <StateBadge key={s.name} {...s} />)}
          </div>
          <SubHead>Duration & Removal</SubHead>
          <P>Every state has a defined duration when applied: end of next turn, successful save, number of rounds, healing past a threshold, or narrative condition. Removal occurs through successful saves, RP expenditure as an action, specific abilities, end-of-turn resolution, or Long Rest.</P>

          {/* ══════════════════════════════════════════════════════════════════
              OVEREXTENSION
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="overextension" title="Overextension" />
          <P>Resource Points represent everything a character is capable of and willing to commit. Banking RP is deep concentration — pushing the body to its absolute limit. Overextension is what happens when that limit is shattered entirely.</P>
          <P>The moment Overextension is declared, the character has opened the floodgates. The body is now operating at a level it was never built to sustain. There is no clean exit from this. <strong style={{color:T.hp}}>The Overextended State applies regardless of whether the save succeeds or fails.</strong> The only question is whether the character can control that power for this one moment — or whether it consumes them before they can use it.</P>
          <SubHead>Declaring Overextension</SubHead>
          <P>Must be declared during the Declaration Phase, before any dice are rolled. Hard limit: total desired RP (T) ≤ 2× available RP (A).</P>
          <Formula>OE Amount = Total Desired RP − Available RP</Formula>
          <Formula>DC = 10 + (10 × OE ÷ A)   [Range: 10–20]</Formula>
          <P>The save is a <strong style={{color:T.hp}}>flat unmodified d20</strong> — no bonuses applicable. RP cannot influence whether the body holds together.</P>
          <Table
            headers={['Available RP', 'Attempted RP', 'OE Amount', 'DC']}
            rows={[
              ['100','110','10','11'],
              ['100','130','30','13'],
              ['100','150','50','15'],
              ['100','175','75','18'],
              ['100','200','100','20'],
            ]}
          />
          <Callout color={T.green} label="ON SUCCESS — THE BODY HOLDS">
            The character channels the full declared RP for this turn. Pressure Steps and damage multipliers calculated from the larger total. The power is theirs — for now. The Overextended State still applies until Long Rest.
          </Callout>
          <Callout color={T.hp} label="ON FAILURE — THE BODY BREAKS">
            The action fails entirely. All RP is lost. The body could not contain what was asked of it. The Overextended State applies: Base RP −50%, no banking, no reactions, all Steps ≤2, disadvantage saves, +Vulnerable. Cannot attempt Overextension again until Long Rest.
          </Callout>

          {/* ══════════════════════════════════════════════════════════════════
              HEALING / REST / DEATH
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="healing" title="Healing, Rest & Death" />
          <SubHead>The Downed State</SubHead>
          <P>At 0 HP a character enters the Downed state — cannot act, generate RP, defend, move, or make physical checks. If not revived before the end of combat: death. No death saving throws. The window is real and urgent.</P>
          <SubHead>Combat Healing</SubHead>
          <Formula>HP Restored = (Healing Dice) × Staked RP</Formula>
          <P>Healing restores HP only. It does not restore RP, remove the Overextended state, or automatically clear other conditions.</P>
          <SubHead>Death & Revival Consequences</SubHead>
          <P>Returning from true death (combat ended before revival) carries mandatory consequences: Exhausted state until next Long Rest, cannot Overextend until Long Rest, Base RP −25% until Long Rest.</P>
          <SubHead>Rest</SubHead>
          <Table
            headers={['Rest Type', 'Duration', 'Recovery']}
            rows={[
              ['Short Rest', '10–30 min', 'Restore 25% Max HP. Remove minor states. Does NOT remove Overextended.'],
              ['Long Rest',  '6–8 hours', 'Full HP. Remove Exhausted & Overextended. Clear temporary penalties. Full narrative readiness.'],
            ]}
          />

          {/* ══════════════════════════════════════════════════════════════════
              OUT-OF-COMBAT
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="ooc" title="Out-of-Combat Resolution" />
          <P>All non-combat checks use a single structure. No RP, no Pressure Steps, no banking.</P>
          <Formula>Check = d20 + Relevant Attribute Modifier</Formula>
          <SubHead>Tiered DC Framework</SubHead>
          <Formula>Final DC = Base Difficulty + Challenge Tier Bonus</Formula>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '14px' }}>
            <div>
              <Table headers={['Base Difficulty', 'Base DC']} rows={[
                ['Trivial','5'], ['Easy','10'], ['Moderate','12'],
                ['Hard','15'], ['Extreme','18'], ['Legendary','20'],
              ]} />
            </div>
            <div>
              <Table headers={['World / Challenge Tier', 'Bonus']} rows={[
                ['Local',  '+0'], ['Veteran', '+5'],  ['Heroic', '+10'],
                ['Mythic', '+15'],['Godlike', '+20'], ['Cosmic', '+30'],
              ]} />
            </div>
          </div>
          <SubHead>Attribute Domains</SubHead>
          <Table
            headers={['Attribute', 'Out-of-Combat Domain']}
            rows={[
              ['Power',    'Strength, endurance, forcing doors, climbing, resisting environments'],
              ['Agility',  'Stealth, lockpicking, acrobatics, fine manipulation, precision movement'],
              ['Focus',    'Investigation, perception, knowledge recall, arcane identification, tracking'],
              ['Presence', 'Persuasion, deception, intimidation, rallying allies, performance, leadership'],
            ]}
          />
          <SubHead>Group Checks & Advantage</SubHead>
          <P>Group checks: majority of successes determines group outcome. Advantage: roll 2d20, keep higher. Disadvantage: roll 2d20, keep lower. Failure should never hard-lock the story — it introduces complication, not dead-ends.</P>

          {/* ══════════════════════════════════════════════════════════════════
              CHARACTER CREATION
          ══════════════════════════════════════════════════════════════════ */}
          <SectionHead id="creation" title="Character Creation" />
          <P>Creation is narrative-first. Mechanics exist to support story. There are no classes, no racial mechanics, no preset archetypes.</P>
          {[
            { n: 1, title: 'Concept & Narrative Identity',   body: 'Who is this person? Establish tone with your DM in Session Zero. Any concept expressible through attributes and equipment is valid.' },
            { n: 2, title: 'Backstory',                      body: 'No required length or format. Strong backstories include: significant relationships, defining events, personal beliefs, past failures, secrets, motivations, and long-term goals.' },
            { n: 3, title: 'Roll Attributes',                body: 'Roll 3d20 per attribute, sum, divide by 3, round down. Assign all four values freely to the four attributes. The Mulligan Rule discards all four values simultaneously if you re-roll.' },
            { n: 4, title: 'Calculate Modifiers',            body: 'Modifier = (Attribute − 10) ÷ 2. These feed attribute checks, defensive saves, and — for the Chosen Attribute — your Base RP.' },
            { n: 5, title: 'Select Chosen Attribute & Roll Growth Pool', body: 'Choose which attribute modifier contributes to Base RP. Roll 1d6 for your starting Growth Pool value. This can change at each level-up.' },
            { n: 6, title: 'Calculate Base RP',              body: 'Base RP = 1 (Level) + Chosen Attribute Modifier + Growth Pool.' },
            { n: 7, title: 'Calculate Max HP',               body: 'Max HP = Base RP × (Level + 10)². At level 1 the squared term is 121. Starting HP will look large — that is intentional.' },
            { n: 8, title: 'Starting Equipment',             body: 'Common to Uncommon rarity at level 1. All equipment must meet attribute prerequisites. DM may allow backstory-justified starting items.' },
            { n: 9, title: 'Magic Access',                   body: 'If Focus meets the Initiate Bracer threshold, a character may equip one and slot up to two Common Spell Gems. Magic is a tool of the equipment system, not a birthright.' },
            { n:10, title: 'Begin Play',                     body: 'Everything on the sheet is a starting position. Attributes will grow, equipment will change, and the Chosen Attribute may shift. Let the story lead.' },
          ].map(({ n, title, body }) => (
            <div key={n} style={{ display: 'flex', gap: '16px', marginBottom: '14px' }}>
              <div style={{ flexShrink: 0, width: '28px', height: '28px', borderRadius: '50%',
                background: T.goldFaint, border: `1px solid ${T.goldDim}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Cinzel',serif", fontSize: '13px', color: T.gold, marginTop: '1px' }}>{n}</div>
              <div>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.14em',
                  color: T.gold, marginBottom: '4px' }}>{title}</div>
                <div style={{ fontSize: '15px', color: T.text, lineHeight: '1.7' }}>{body}</div>
              </div>
            </div>
          ))}

          {/* ══════════════════════════════════════════════════════════════════
              ENEMY SYSTEM — DM ONLY
          ══════════════════════════════════════════════════════════════════ */}
          {isDM && (
            <>
              <div style={{ margin: '40px 0 20px', padding: '14px 18px',
                background: T.dmGold + '0c', border: `1px solid ${T.dmGold}33`,
                borderRadius: '3px' }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.2em',
                  color: T.dmGold, marginBottom: '6px' }}>⚔ DM-ONLY SECTIONS BELOW</div>
                <div style={{ fontSize: '15px', color: T.textMuted }}>
                  The following sections are visible only to users with DM accounts.
                </div>
              </div>

              <SectionHead id="enemies" title="Enemy System" dmOnly />
              <P>Enemies are encounter tools, not player-equivalent characters. Their design philosophy prioritizes DM clarity, bounded accuracy, and dramatic escalation capacity.</P>
              <SubHead>Stat Block Components</SubHead>
              <P>Every enemy requires: Hit Points (tuned to encounter intent), Resistance Modifier (flat save bonus replacing defensive RP), Attack Tiers (Partial/Standard/Full with preset Pressure Steps and damage multipliers), Tier Multipliers, optional Traits/States/Abilities, and Pool Interaction Limits.</P>
              <SubHead>HP Design</SubHead>
              <Table
                headers={['Classification', 'Intended Durability']}
                rows={[
                  ['Minion',   '1–2 solid hits before falling'],
                  ['Standard', '3–5 solid hits — a brief but real engagement'],
                  ['Elite',    '6–10 solid hits — a meaningful fight'],
                  ['Boss',     '10–20+ solid hits — a multi-phase encounter'],
                ]}
              />
              <SubHead>Attack Tiers</SubHead>
              <P>When an enemy attacks, select the tier based on narrative and tactical context. Enemies do not generate Defensive Steps — they defend with a flat Resistance Modifier on their d20 save.</P>
              <Table
                headers={['Tier', 'Pressure Steps', 'Purpose']}
                rows={[
                  ['Partial',  '2',   'Light attacks, testing defenses, positioned escalation'],
                  ['Standard', '3',   'Core attack pattern for the encounter'],
                  ['Full',     '4–5', 'Heavy offensive push, reserved for dramatic moments'],
                ]}
              />
              <P>Bosses may have additional specialized tiers or multi-phase mechanics that unlock as their HP falls. Enemies do not use the RP percentage table — their Step counts are fixed in the stat block.</P>

              {/* ══════════════════════════════════════════════════════════════
                  ENCOUNTER POOL — DM ONLY
              ══════════════════════════════════════════════════════════════ */}
              <SectionHead id="encounter" title="Encounter Pool" dmOnly />
              <P>The Encounter Pool is a round-refreshing pool of bonus damage multiplier. It represents momentum, environmental intensity, reinforcements, or the battlefield shifting in the enemy's favor.</P>
              <Formula>Pool Size = Avg Party Base RP × Party Size × Enemy Weight × Pool Factor</Formula>
              <Table
                headers={['Difficulty', 'Pool Factor']}
                rows={[
                  ['Easy',            '0.25'],
                  ['Standard',        '0.50'],
                  ['Hard',            '0.75'],
                  ['Deadly / Boss Phase', '1.00'],
                  ['Horde (Optional)','1.25'],
                ]}
              />
              <SubHead>Pool Rules</SubHead>
              <P>The pool is large at encounter level but each individual enemy is strictly bounded: no single enemy may draw from the Encounter Pool beyond <strong style={{color:T.dmGold}}>twice their Full Tier Multiplier</strong>. This prevents any single enemy becoming a tactical nuke through pool abuse.</P>
              <Callout color={T.dmGold} label="ENEMY BANKING EQUIVALENT">
                An enemy that did not attack on its previous turn may access the Encounter Pool for a bonus multiplier on its next attack. This creates genuine tactical tension — players should consider whether to focus-fire an enemy that hasn't acted, knowing it may be building to a bigger hit next turn.
              </Callout>
              <SubHead>Faction & Favor Quick Reference</SubHead>
              <Table
                headers={['Favor Score', 'Status']}
                rows={[
                  ['-100', 'Hostile — actively hunting them'],
                  ['-50',  'Unfriendly — obstructive, cold'],
                  ['0',    'Neutral — no particular opinion'],
                  ['+25',  'Recognized — they know the name'],
                  ['+50',  'Trusted — reliable allies'],
                  ['+75',  'Allied — go out of their way'],
                  ['+100', 'Champion — one of them'],
                ]}
              />
            </>
          )}

          {/* Footer */}
          <div style={{ marginTop: '60px', paddingTop: '20px', borderTop: `1px solid ${T.border}`,
            textAlign: 'center', fontFamily: "'Cinzel',serif", fontSize: '11px',
            letterSpacing: '0.3em', color: T.textDim }}>
            VELION MYTHERA COMPENDIUM — RULES REFERENCE — v1.0
          </div>
          <div style={{ height: '40px' }} />

        </div>
      </div>
    </div>
  );
}