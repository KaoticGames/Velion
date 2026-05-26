import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { characterKeys } from "@/hooks/useCharacter";
import api, { extractApiError } from "@/lib/api";
import { io } from "socket.io-client";
import { useAuthStore } from "@/store/authStore";
import { isSocketSessionAuthFailure, kickToLogin } from "@/lib/authSession";
import DiceLog from "@/vtt/DiceLog";
import {
  GAME_STATES,
  GAME_STATE_BY_NAME,
  STATE_CAT_COLOR,
  effectBullets,
  classifyEffectBullet,
} from "@/lib/gameStates";
import SpecialAbilitiesPanel from "@/components/special-abilities/SpecialAbilitiesPanel";
import { abilityAsWeapon, abilityAsGem } from "@/lib/specialAbilities";
import { useWizardDiceRoll } from "@/hooks/useWizardDiceRoll";
import LevelProgressionFlow from "@/components/character-sheet/LevelProgressionFlow";

const SOCKET_URL = (import.meta.env.VITE_SOCKET_URL || "").replace(/\/$/, "");

// ── Constants ─────────────────────────────────────────────────────────────
const RARITIES     = ['None','Common','Uncommon','Rare','Epic','Legendary','Mythic'];
const RARITY_COLOR = { None:'#55556a', Common:'#b0b0b0', Uncommon:'#3dba6a', Rare:'#4a9de8', Epic:'#a055e8', Legendary:'#e8a020', Mythic:'#ff5555' };
const RARITY_DICE  = { None:0, Common:1, Uncommon:2, Rare:3, Epic:4, Legendary:5, Mythic:6 };
const GEM_DICE_MAP = { Common:'1d6', Uncommon:'1d6', Rare:'2d6', Epic:'3d6', Legendary:'4d6', Mythic:'5d6+' };
const ELEMENTS     = ['Fire','Ice','Lightning','Poison','Shadow','Radiant','Arcane','Nature','Earth','Wind'];
const ELEM_COLOR   = { Fire:'#e87040', Ice:'#60c8e8', Lightning:'#f0d050', Poison:'#60c850', Shadow:'#9060c0', Radiant:'#f0e080', Arcane:'#a060e8', Nature:'#50a040', Earth:'#c09050', Wind:'#80c8a0' };
const DMG_TYPES    = ['Physical',...ELEMENTS];
const ARMOR_SLOTS  = ['Helmet','Chestplate','Leggings','Gauntlets','Boots','Shirt','Pants'];
const ATTRS        = ['Power','Agility','Focus','Presence'];
const ATTR_COLOR   = { Power:'#e87050', Agility:'#50c878', Focus:'#7090e8', Presence:'#e8b050' };
const BRACER_GRADES= ['None','Initiate','Adept','Exemplar','Ascendant'];
const BRACER_SLOTS = { None:0, Initiate:2, Adept:4, Exemplar:6, Ascendant:8 };
const DIE_TYPES    = ['d4','d6','d8','d10','d12','d20'];
const STATE_CATEGORIES = ['Control', 'Capacity', 'Damage', 'Altered', 'Structural'];
const FACTION_TIERS = [
  {min:75,  max:100, label:'Champion',   color:'#3dba6a'},
  {min:50,  max:74,  label:'Allied',     color:'#50d070'},
  {min:25,  max:49,  label:'Trusted',    color:'#a0c850'},
  {min:1,   max:24,  label:'Recognized', color:'#c8c050'},
  {min:0,   max:0,   label:'Neutral',    color:'#888888'},
  {min:-49, max:-1,  label:'Unfriendly', color:'#d09050'},
  {min:-100,max:-50, label:'Hostile',    color:'#e05050'},
];

// ── Helpers ───────────────────────────────────────────────────────────────
const calcMod  = v => Math.floor((v - 10) / 2);
const mStr     = v => v >= 0 ? `+${v}` : `${v}`;
const fmtNum   = n => Math.round(n).toLocaleString();
const rollD    = s => Math.floor(Math.random() * s) + 1;
const uid      = () => `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const getFavor = f => FACTION_TIERS.find(t => f >= t.min && f <= t.max) || FACTION_TIERS[4];
const pSteps   = (rp, avail) => {
  if (!avail || rp <= 0) return 0;
  const p = rp / avail;
  return p<=.2?1 : p<=.4?2 : p<=.6?3 : p<=.8?4 : 5;
};

/** Defensive Bonus to save (Compendium): RP committed ÷ Base RP → +0…+5 (same % bands as pSteps). */
const defensiveBonusFromCommit = (rpCommitted, baseRP) => pSteps(rpCommitted, baseRP);

// Seed values so HP/RP start at max
const INIT_LVL    = 1;
const INIT_ATTRS  = { Power:10, Agility:10, Focus:10, Presence:10 };
const INIT_CHOSEN = 'Power';
const INIT_POOL   = 3;
const INIT_BASE_RP= INIT_LVL + calcMod(INIT_ATTRS[INIT_CHOSEN]) + INIT_POOL;
const INIT_MAX_HP = INIT_BASE_RP * Math.pow(INIT_LVL + 10, 2);

const mkArmor   = () => ({ name:'', category:'Light', rarity:'None', mitigation:0, resistances:Object.fromEntries(ELEMENTS.map(e=>[e,0])) });
const mkWeapon  = () => ({ id:uid(), name:'New Weapon', rarity:'Common', dieType:'d6', channels:[{element:'Physical',dice:1}], attrReq:'', notes:'' });
const mkGem     = () => ({ element:'Fire', rarity:'Common', notes:'' });
const mkFaction = () => ({ id:uid(), name:'', favor:0 });



const T = {
  bg:'#06070c', surface:'#0a0c14', card:'#0d1018', border:'#1c2030',
  gold:'#c4922a', goldDim:'#5a3e10', text:'#e4d8c0', textMuted:'#706858',
  textDim:'#282430', hp:'#e05050', rp:'#4a9de8', magic:'#9b6fe8',
};
const crd = (accent=T.gold, xtra={}) => ({
  background:T.card, border:`1px solid ${T.border}`,
  borderTop:`2px solid ${accent}`, borderRadius:'4px', padding:'16px', ...xtra
});
const inp = (xtra={}) => ({
  background:T.surface, border:`1px solid ${T.border}`, color:T.text,
  borderRadius:'3px', padding:'5px 10px', fontSize: '18px',
  fontFamily:"'EB Garamond',serif", width:'100%', outline:'none', ...xtra
});
const LBL = {
  fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'0.14em',
  color:T.textMuted, textTransform:'uppercase', display:'block', marginBottom:'4px'
};
const Btn = (c=T.gold, xtra={}) => ({
  background:'transparent', border:`1px solid ${c}`, color:c,
  borderRadius:'3px', padding:'5px 14px', fontSize: '14px',
  fontFamily:"'Cinzel',serif", letterSpacing:'0.1em', cursor:'pointer', ...xtra
});

/** Module-scoped so React does not remount children on every parent render (fixes input focus loss). */
function SecTitle({ children, color = T.gold, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ width: '14px', height: '1px', background: color, display: 'inline-block' }} />
        <span style={{ fontFamily: "'Cinzel',serif", fontSize: '14px', letterSpacing: '0.2em', color, textTransform: 'uppercase', fontWeight: '600' }}>{children}</span>
        <span style={{ width: '14px', height: '1px', background: color, display: 'inline-block' }} />
      </div>
      {right}
    </div>
  );
}

function Fld({ label, children, style = {} }) {
  return (
    <div style={style}>
      <label style={LBL}>{label}</label>
      {children}
    </div>
  );
}

function Badge({ rarity }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        borderRadius: '10px',
        fontSize: '14px',
        fontFamily: "'Cinzel',serif",
        background: `${RARITY_COLOR[rarity]}22`,
        border: `1px solid ${RARITY_COLOR[rarity]}55`,
        color: RARITY_COLOR[rarity],
      }}
    >
      {rarity}
    </span>
  );
}

const BULLET_KIND_LABEL = { restrict: 'Restrictions', allow: 'Still allowed', effect: 'Effects' };
const BULLET_KIND_COLOR = { restrict: '#d07060', allow: '#60a878', effect: T.textMuted };

function StateEffectTooltip({ tip }) {
  if (!tip || typeof document === 'undefined') return null;
  const sd = GAME_STATE_BY_NAME[tip.name];
  if (!sd) return null;

  const bullets = effectBullets(sd.effect);
  const grouped = { restrict: [], allow: [], effect: [] };
  bullets.forEach((b) => grouped[classifyEffectBullet(b)].push(b));

  const sections = (['restrict', 'allow', 'effect']).filter((k) => grouped[k].length > 0);
  const placeAbove = tip.y > 200;
  const maxW = 340;

  return createPortal(
    <div
      role="tooltip"
      style={{
        position: 'fixed',
        left: Math.min(Math.max(tip.x, maxW / 2 + 12), window.innerWidth - maxW / 2 - 12),
        top: placeAbove ? tip.y - 10 : tip.y + 10,
        transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        width: maxW,
        zIndex: 1100,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          background: '#0d1018',
          border: `1px solid ${sd.color}55`,
          borderTop: `2px solid ${sd.color}`,
          borderRadius: '4px',
          padding: '12px 14px',
          boxShadow: `0 8px 28px rgba(0,0,0,0.65), 0 0 16px ${sd.color}22`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', gap: '8px' }}>
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: '16px', color: sd.color, fontWeight: '600', letterSpacing: '0.06em' }}>
            {sd.name}
          </span>
          <span style={{ fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.12em', color: STATE_CAT_COLOR[sd.cat], flexShrink: 0 }}>
            {(sd.catLabel ?? sd.cat).toUpperCase()}
          </span>
        </div>
        {sections.map((kind) => (
          <div key={kind} style={{ marginBottom: kind === sections[sections.length - 1] ? 0 : '10px' }}>
            <div
              style={{
                fontFamily: "'Cinzel',serif",
                fontSize: '11px',
                letterSpacing: '0.14em',
                color: BULLET_KIND_COLOR[kind],
                marginBottom: '5px',
                opacity: 0.9,
              }}
            >
              {BULLET_KIND_LABEL[kind]}
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', listStyle: 'disc' }}>
              {grouped[kind].map((line) => (
                <li
                  key={line}
                  style={{
                    fontSize: '15px',
                    lineHeight: 1.5,
                    color: BULLET_KIND_COLOR[kind],
                    marginBottom: '3px',
                  }}
                >
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function ModalWrap({ children, accentColor = T.gold, minW = '400px' }) {
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 999 }} />
      <div
        style={{
          position: 'fixed',
          top: '72px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '100%',
          maxWidth: '700px',
          padding: '0 16px',
          zIndex: 1000,
          maxHeight: 'calc(100vh - 96px)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            background: T.card,
            border: `1px solid ${accentColor}44`,
            borderTop: `2px solid ${accentColor}`,
            borderRadius: '6px',
            padding: '26px',
            minWidth: minW,
            boxSizing: 'border-box',
            overflowY: 'auto',
            flex: 1,
          }}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

// ── Library ↔ Sheet data-mapping helpers ──────────────────────────────────
// Maps library damage_type → sheet element name
const libDmgToSheet = t => {
  if (['slashing','piercing','bludgeoning'].includes(t)) return 'Physical';
  if (t === 'light') return 'Radiant';
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const buildAttrReq = w => {
  const r = [];
  if (w.req_power  > 0) r.push(`PWR ${w.req_power}`);
  if (w.req_agility > 0) r.push(`AGI ${w.req_agility}`);
  if (w.req_focus  > 0) r.push(`FOC ${w.req_focus}`);
  return r.join(', ');
};
const libWeaponToSheet = w => ({
  id: w.id, name: w.name, rarity: cap(w.rarity),
  dieType: `d${w.base_die_type}`,
  channels: (w.channels||[]).map(ch => ({ element: libDmgToSheet(ch.damage_type), dice: ch.num_dice })),
  attrReq: buildAttrReq(w), notes: w.description || '', libraryId: w.id,
});
const libArmorToSheet = a => ({
  name: a.name, category: cap(a.category), rarity: cap(a.rarity),
  mitigation: parseFloat(a.mitigation_percent) || 0,
  resistances: Object.fromEntries(ELEMENTS.map(e => [e, 0])),
  libraryId: a.id,
});

/** Merge persisted sheet tweaks when the equipped library piece still matches. */
function mergeArmorSheetOverrides(base, slotName, overridesRoot) {
  const entry = overridesRoot?.[slotName];
  if (!entry || typeof entry !== 'object') return base;
  const libId = entry.library_item_id !== undefined ? entry.library_item_id : undefined;
  if (libId !== undefined && libId !== null && libId !== base.libraryId) return base;
  if (libId === null && base.libraryId) return base;
  const out = { ...base, resistances: { ...base.resistances } };
  if (typeof entry.mitigation === 'number' && Number.isFinite(entry.mitigation)) {
    out.mitigation = Math.max(0, Math.min(100, entry.mitigation));
  }
  if (entry.resistances && typeof entry.resistances === 'object') {
    for (const el of ELEMENTS) {
      const v = entry.resistances[el];
      if (typeof v === 'number' && Number.isFinite(v)) {
        out.resistances[el] = Math.max(0, Math.min(200, v));
      }
    }
  }
  return out;
}

function buildSheetArmorOverrides(armorState) {
  const out = {};
  for (const slot of ARMOR_SLOTS) {
    const p = armorState[slot];
    if (!p || (!p.name && p.rarity === 'None')) continue;
    out[slot] = {
      library_item_id: p.libraryId ?? null,
      mitigation: Number(p.mitigation) || 0,
      resistances: Object.fromEntries(
        ELEMENTS.map(e => [e, Math.max(0, Math.min(200, Number(p.resistances[e]) || 0))]),
      ),
    };
  }
  return out;
}
const libGemElement = t => {
  if (t === 'light') return 'Radiant';
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** OE = extra RP borrowed; A = available RP before borrow. DC in [10, 20]. Matches rules compendium. */
function calcOverextensionDC(oeAmount, availableRP) {
  const A = Number(availableRP) || 0;
  const OE = Math.max(0, Number(oeAmount) || 0);
  if (!A) return 20;
  return Math.max(10, Math.min(20, Math.round(10 + (10 * OE) / A)));
}

// ── StableNumInput: prevents focus loss in modals ─────────────────────────
// Keeps a local string while typing; syncs from `value` in an effect so slider / +/- updates apply (never setState during render).
function StableNumInput({ value, onChange, min=0, max=Infinity, style={}, placeholder='', autoFocus=false, clearOnFocus=false }) {
  const [local, setLocal] = useState(() => String(value ?? ''));

  useLayoutEffect(() => {
    setLocal(String(value ?? ''));
  }, [value]);

  const commit = useCallback((raw) => {
    const n = raw==='' ? min : Math.max(min, Math.min(max, parseInt(raw,10)||0));
    setLocal(String(n));
    onChange(n);
  }, [min, max, onChange]);

  return (
    <input
      type="text" inputMode="numeric"
      value={local} autoFocus={autoFocus} placeholder={placeholder}
      onChange={e => setLocal(e.target.value.replace(/[^0-9]/g,''))}
      onFocus={() => { if (clearOnFocus) setLocal(''); }}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if(e.key==='Enter') commit(e.target.value); }}
      style={style}
    />
  );
}

export default function VelionSheet({ characterId = undefined, initialData = undefined, sessionId = undefined }) {
  const subscriptionTier = useAuthStore((s) => s.user?.subscription_tier ?? 'free');
  const canCreateCustomAbilities = subscriptionTier !== 'free';
  const armorOverrides =
    initialData?.sheet_armor_overrides &&
    typeof initialData.sheet_armor_overrides === 'object' &&
    !Array.isArray(initialData.sheet_armor_overrides)
      ? initialData.sheet_armor_overrides
      : {};

  const equipmentSig = useMemo(() => {
    const eq = initialData?.equipment;
    if (!eq?.length) return '';
    return [...eq].map(e => `${e.slot}:${e.item_type}:${e.item_id}`).sort().join('|');
  }, [initialData?.equipment]);

  const queryClient = useQueryClient();
  const accessToken = useAuthStore(s => s.accessToken);
  const rollUserId = useAuthStore(s => s.user?.id ?? '');
  const rollSocketRef = useRef(null);
  const [sessionDiceLog, setSessionDiceLog] = useState([]);
  /** false = expanded roll log panel; true = upper-right dock chip only */
  const [diceLogCollapsed, setDiceLogCollapsed] = useState(true);
  const rollQueueRef = useRef([]);
  const rollLockRef = useRef(false);
  /** Set after `session:state` — do not emit `dice:roll` before join completes */
  const sessionDiceReadyRef = useRef(false);
  const pendingSessionDiceRollRef = useRef([]);
  const weaponDmgCtxRef = useRef(null);
  const weaponDmgAccRef = useRef([]);
  const gemDmgCtxRef = useRef(null);
  const gemDmgAccRef = useRef([]);
  const portRef = useRef();
  const [portrait, setPortrait] = useState(null);
  const [portraitUploading, setPortraitUploading] = useState(false);
  const [portraitErr, setPortraitErr] = useState('');

  const PORTRAIT_TYPES = useMemo(() => new Set(['image/png', 'image/jpeg', 'image/webp']), []);

  const canLoadImageUrl = useCallback((url) => new Promise((resolve) => {
    if (!url) { resolve(false); return; }
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  }), []);

  const deriveUnsignedR2ObjectUrl = (uploadUrl) => {
    try {
      const u = new URL(uploadUrl);
      const p = u.pathname.startsWith('/') ? u.pathname.slice(1) : u.pathname;
      if (!p) return '';
      return `${u.origin}/${p}`;
    } catch {
      return '';
    }
  };

  const resolvePortraitPublicUrl = useCallback(async (presign) => {
    const candidates = [];
    if (typeof presign?.public_url === 'string' && presign.public_url.trim()) {
      candidates.push(presign.public_url.trim());
    }
    const fallback = deriveUnsignedR2ObjectUrl(presign?.upload_url || '');
    if (fallback && !candidates.includes(fallback)) candidates.push(fallback);
    for (const url of candidates) {
      // Probe image URL before persisting so broken public-domain config doesn't save bad links.
      // eslint-disable-next-line no-await-in-loop
      const ok = await canLoadImageUrl(url);
      if (ok) return url;
    }
    return candidates[0] || '';
  }, [canLoadImageUrl]);

  const getPortraitRenderUrl = useCallback(async (characterIdArg, storedUrl) => {
    if (!characterIdArg || !storedUrl || typeof storedUrl !== 'string') return storedUrl;
    if (storedUrl.startsWith('data:')) return storedUrl;
    try {
      const { data } = await api.post('/tokens/portrait/read-url', {
        character_id: characterIdArg,
        portrait_url: storedUrl,
      });
      return data?.read_url || storedUrl;
    } catch {
      return storedUrl;
    }
  }, []);

  const onPort = useCallback(async (e) => {
    const f = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!f) return;
    setPortraitErr('');

    if (!characterId) {
      const r = new FileReader();
      r.onload = (ev) => setPortrait(ev.target.result);
      r.readAsDataURL(f);
      return;
    }

    let contentType = f.type || 'image/jpeg';
    if (contentType === 'image/jpg') contentType = 'image/jpeg';
    if (!PORTRAIT_TYPES.has(contentType)) {
      setPortraitErr('Use PNG, JPEG, or WEBP.');
      return;
    }

    setPortraitUploading(true);
    try {
      const { data: presign } = await api.post('/tokens/upload-url', {
        character_id: characterId,
        filename: f.name || 'portrait.jpg',
        content_type: contentType,
        asset_type: 'portrait',
      });
      const putRes = await fetch(presign.upload_url, {
        method: 'PUT',
        body: f,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) {
        throw new Error(`Storage upload failed (${putRes.status})`);
      }
      const pub = await resolvePortraitPublicUrl(presign);
      if (!pub) throw new Error('No usable portrait URL returned from storage.');
      const { data: updated } = await api.patch(`/characters/${characterId}`, { portrait_url: pub });
      const url = updated?.portrait_url ?? pub;
      const renderUrl = await getPortraitRenderUrl(characterId, url);
      setPortrait(renderUrl);
      queryClient.setQueryData(characterKeys.detail(characterId), (prev) =>
        prev && typeof prev === 'object' ? { ...prev, portrait_url: url } : prev,
      );
      queryClient.invalidateQueries({ queryKey: characterKeys.list() });
    } catch (err) {
      const ex = extractApiError(err);
      setPortraitErr(ex?.message || err?.message || 'Portrait upload failed.');
      console.error('[VelionSheet] portrait upload:', err);
    } finally {
      setPortraitUploading(false);
    }
  }, [PORTRAIT_TYPES, characterId, getPortraitRenderUrl, queryClient, resolvePortraitPublicUrl]);

  // ── Identity ──
  const [charName,   setCharName]   = useState('');
  const [level,      setLevel]      = useState(INIT_LVL);
  const [chosenAttr, setChosenAttr] = useState(INIT_CHOSEN);
  const [concept,    setConcept]    = useState('');
  const [gold,       setGold]       = useState(0);

  // ── Attributes ──
  const [attrs, setAttrs] = useState(INIT_ATTRS);

  // ── Growth Pool ──
  const [growthPool, setGrowthPool] = useState(INIT_POOL);

  const enqueueDiceRolls = (items) => {
    const wasIdle = !rollLockRef.current;
    items.forEach((i) => rollQueueRef.current.push(i));
    if (wasIdle && rollQueueRef.current.length) {
      rollLockRef.current = true;
      window.dispatchEvent(new CustomEvent('velion:dice-roll-request', { detail: { ...rollQueueRef.current[0], autoOpen: false } }));
    }
  };
  const requestSessionDiceRoll = (item) => enqueueDiceRolls([item]);
  const resetDiceQueue = () => {
    rollLockRef.current = false;
    rollQueueRef.current = [];
  };

  useEffect(() => {
    const onDiceLogCommit = (e) => {
      const entry = e?.detail;
      if (!entry) return;
      setSessionDiceLog((prev) => [entry, ...prev].slice(0, 120));
    };
    window.addEventListener('velion:dice-log-commit', onDiceLogCommit);
    return () => {
      window.removeEventListener('velion:dice-log-commit', onDiceLogCommit);
    };
  }, []);

  useEffect(() => {
    if (!sessionId || !accessToken || !SOCKET_URL) return;
    sessionDiceReadyRef.current = false;
    pendingSessionDiceRollRef.current = [];
    const flushPendingDiceRolls = (sock) => {
      if (!sock?.connected || !sessionDiceReadyRef.current) return;
      const q = pendingSessionDiceRollRef.current;
      if (!q.length) return;
      const batch = q.splice(0, q.length);
      batch.forEach((rest) => sock.emit('dice:roll', rest));
    };
    const socket = io(`${SOCKET_URL}/session`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
    });
    rollSocketRef.current = socket;
    socket.on('connect_error', (err) => {
      if (isSocketSessionAuthFailure(err)) {
        kickToLogin();
      }
    });
    socket.on('connect', () => {
      sessionDiceReadyRef.current = false;
      socket.emit('session:join', { session_id: sessionId, character_id: characterId });
    });
    socket.on('session:state', (data) => {
      sessionDiceReadyRef.current = true;
      const log = Array.isArray(data?.diceLog) ? data.diceLog : [];
      setSessionDiceLog(log.slice(0, 120));
      flushPendingDiceRolls(socket);
    });
    socket.on('dice:roll_start', (p) => {
      window.dispatchEvent(new CustomEvent('velion:session-dice-roll-start', { detail: p }));
    });
    socket.on('dice:result', (entry) => {
      window.dispatchEvent(new CustomEvent('velion:dice-result-pending', { detail: entry }));
    });
    const onAuthorityRollRequest = (event) => {
      const payload = event?.detail;
      if (!payload || !sessionId) return;
      event.preventDefault();
      const sock = rollSocketRef.current;
      const queueIfNeeded = () => {
        if (pendingSessionDiceRollRef.current.length < 32) {
          pendingSessionDiceRollRef.current.push(payload);
        }
      };
      if (!sock) {
        queueIfNeeded();
        return;
      }
      if (sock.connected && sessionDiceReadyRef.current) {
        sock.emit('dice:roll', payload);
      } else {
        queueIfNeeded();
      }
    };
    window.addEventListener('velion:dice-roll-authority-request', onAuthorityRollRequest);
    // Session rolls use server physics only — clients do not submit local results.
    return () => {
      window.removeEventListener('velion:dice-roll-authority-request', onAuthorityRollRequest);
      sessionDiceReadyRef.current = false;
      pendingSessionDiceRollRef.current = [];
      socket.disconnect();
      rollSocketRef.current = null;
    };
  }, [sessionId, accessToken, characterId, rollUserId]);

  const rollSave = (attr, mode = 'normal', defRpCommit = 0) => {
    const resistanceMod = calcMod(attrs[attr]);
    let modifier = resistanceMod;
    let defensiveBonus = 0;
    let committedRp = 0;
    if (mode === 'defensive') {
      committedRp = Math.max(0, Math.min(Number(defRpCommit) || 0, curRP));
      defensiveBonus = defensiveBonusFromCommit(committedRp, effBaseRP);
      modifier = resistanceMod + defensiveBonus;
      if (committedRp > 0) setCurRP((p) => Math.max(0, p - committedRp));
    }
    const use2 = mode === 'advantage' || mode === 'disadvantage';
    requestSessionDiceRoll({
      formula: use2 ? '2d20' : '1d20',
      label: mode === 'defensive' ? `${attr} Defensive Save` : `${attr} Check`,
      modifier,
      advantageKeep: mode === 'advantage' ? 'high' : mode === 'disadvantage' ? 'low' : undefined,
      source_label: charName || 'Character',
      requestMeta: {
        kind: 'saveRoll',
        attr,
        mode,
        resistanceMod,
        defensiveBonus,
        defRpCommit: mode === 'defensive' ? committedRp : 0,
      },
    });
  };

  // ── Context Menu (right-click on attribute cards) ──
  const [ctxMenu, setCtxMenu] = useState(null); // {attr, x, y}
  const closeCtx = () => setCtxMenu(null);

  // ── Defensive Save Pre-Roll Modal ──
  const [defModal, setDefModal] = useState(null); // {attr} | null
  const [defRpInput, setDefRpInput] = useState(0);

  // ── Derived ──
  const chosenMod = calcMod(attrs[chosenAttr]);
  const baseRP    = level + chosenMod + growthPool;
  const maxHP     = baseRP * Math.pow(level + 10, 2);

  // ── Active States ──
  const [active, setActive] = useState(new Set());
  const addState = name => { if (!name) return; setActive(p => new Set([...p, name])); };
  const removeState = name => {
    setStateTip(prev => (prev?.name === name ? null : prev));
    setActive(p => { const n = new Set(p); n.delete(name); return n; });
  };
  const [stateTip, setStateTip] = useState(null); // { name, x, y } | null
  const S = {
    silenced:    active.has('Silenced'),
    exhausted:   active.has('Exhausted'),
    overextended:active.has('Overextended'),
    vulnerable:  active.has('Vulnerable')||active.has('Overextended'),
    fortified:   active.has('Fortified'),
    restrained:  active.has('Restrained'),
    enraged:     active.has('Enraged'),
    suppressed:  active.has('Suppressed'),
    stunned:     active.has('Stunned'),
    asleep:      active.has('Asleep'),
  };
  const bankBlocked = S.restrained||S.exhausted||S.overextended||S.enraged||S.stunned||S.asleep;
  const effBaseRP   = S.overextended ? Math.floor(baseRP*0.5) : S.exhausted ? Math.floor(baseRP*0.75) : baseRP;

  // ── RP & HP ──
  const [curRP,   setCurRP]   = useState(INIT_BASE_RP);
  const [bankRP,  setBankRP]  = useState(0);
  const [banking, setBanking] = useState(false);
  const [curHP,   setCurHP]   = useState(INIT_MAX_HP);
  /** True while Start Turn has been used for the current round. */
  const [inActiveTurn, setInActiveTurn] = useState(false);
  /** Bank only after Start Turn; still allow clearing ○ BANKED if turn ended while banking. */
  const bankNeedsActiveTurn = !inActiveTurn && !banking;
  /** One new bank commit until End Turn merges or cancels; Bank locked while temporary RP from a prior merge is active. */
  const [canCommitBank, setCanCommitBank] = useState(true);
  /** RP merged from bank on End Turn — stripped next End Turn (above base) if not spent. */
  const [bankTempRemaining, setBankTempRemaining] = useState(0);

  const handleBank = () => {
    if (bankBlocked) return;
    if (bankNeedsActiveTurn) return;
    if (!banking) {
      if (!canCommitBank) return;
      setBankRP(curRP);
      setBanking(true);
      setCanCommitBank(false);
    } else {
      setBanking(false);
      setBankRP(0);
      setCanCommitBank(true);
    }
  };
  const handleTurnStart = () => {
    if (inActiveTurn) return;
    setInActiveTurn(true);
    if (bankTempRemaining > 0) {
      setCanCommitBank(false);
      return;
    }
    if (bankRP > 0 || banking) {
      setCanCommitBank(false);
      return;
    }
    setCurRP(effBaseRP);
    setCanCommitBank(true);
  };
  const handleEndTurn = () => {
    setInActiveTurn(false);
    const mTemp = bankTempRemaining;
    const mBank = bankRP;
    const mBanking = banking;
    const eff = effBaseRP;

    setCurRP((prev) => {
      let next = prev;
      if (mTemp > 0) {
        const strip = Math.min(mTemp, Math.max(0, next - eff));
        next -= strip;
      }
      if (mBank > 0 || mBanking) {
        next += mBank;
      }
      return next;
    });

    if (mBank > 0 || mBanking) {
      setBankTempRemaining(mBank);
      setCanCommitBank(false);
    } else if (mTemp > 0) {
      setBankTempRemaining(0);
      setCanCommitBank(true);
    } else {
      setCanCommitBank(true);
    }

    setBankRP(0);
    setBanking(false);
  };
  const handleShortRest = () => {
    setCurHP(p=>Math.min(maxHP,p+Math.floor(maxHP*0.25)));
    setCurRP(effBaseRP);
    setBankTempRemaining(0);
    setActive(p=>{const n=new Set(p);['Burned','Poisoned','Bleeding'].forEach(s=>n.delete(s));return n;});
  };
  const handleLongRest = () => {
    setCurHP(maxHP);
    setCurRP(baseRP);
    setActive(new Set());
    setBankRP(0);
    setBanking(false);
    setInActiveTurn(false);
    setBankTempRemaining(0);
    setCanCommitBank(true);
  };

  useEffect(() => {
    setInActiveTurn(false);
    setBankTempRemaining(0);
    setCanCommitBank(true);
  }, [characterId]);

  // ── Level Up Modal ──
  const [luOpen,  setLuOpen]  = useState(false);
  const [luDist,  setLuDist]  = useState({Power:0,Agility:0,Focus:0,Presence:0});
  const [luTotal, setLuTotal] = useState(0);
  const [luGRoll, setLuGRoll] = useState(null);
  const [luRollErr, setLuRollErr] = useState('');
  const [luChosen,setLuChosen]= useState(INIT_CHOSEN);
  const { requestRoll: requestLuGrowthRoll, rolling: luDiceRolling } = useWizardDiceRoll();
  const [progFlow, setProgFlow] = useState(null);

  const syncCharacterFromApi = useCallback((data) => {
    if (!data) return;
    setLevel(data.level || 1);
    setAttrs({
      Power: data.power || 10,
      Agility: data.agility || 10,
      Focus: data.focus || 10,
      Presence: data.presence || 10,
    });
    setChosenAttr(cap(data.chosen_attribute || 'power'));
    setGrowthPool(data.growth_pool_total || 0);
    const maxHp = Number(data.max_hp) || 0;
    const curHp = Number(data.current_hp);
    setCurHP(Number.isFinite(curHp) && curHp > 0 ? curHp : maxHp);
    setCurRP(data.current_rp ?? data.base_rp ?? 1);
    setBankRP(data.rp_banked ?? 0);
    setBanking(!!data.rp_banking);
    setCanCommitBank((Number(data.rp_banked) || 0) <= 0 && !data.rp_banking);
  }, []);
  const openLevelUp = () => {
    setLuDist({Power:0,Agility:0,Focus:0,Presence:0});
    setLuTotal(0);
    setLuGRoll(null);
    setLuRollErr('');
    setLuChosen(chosenAttr);
    setLuOpen(true);
  };
  const rollLuGrowth = async () => {
    if (luDiceRolling) return;
    setLuRollErr('');
    try {
      const { result } = await requestLuGrowthRoll('growth1d6', 'Level Up — Growth Pool 1d6');
      setLuGRoll(result);
    } catch (err) {
      setLuGRoll(null);
      setLuRollErr(err instanceof Error ? err.message : 'Dice roll failed');
    }
  };
  const luAdd = a => { if(luDist[a]>=1||luTotal>=2) return; setLuDist(p=>({...p,[a]:p[a]+1})); setLuTotal(p=>p+1); };
  const luSub = a => { if(luDist[a]<=0) return; setLuDist(p=>({...p,[a]:p[a]-1})); setLuTotal(p=>p-1); };
  const luNewLvl   = level+1;
  const luNewAttrs = Object.fromEntries(ATTRS.map(a=>[a,attrs[a]+luDist[a]]));
  const luNewMod   = calcMod(luNewAttrs[luChosen]);
  const luNewPool  = growthPool+(luGRoll||0);
  const luNewBase  = luNewLvl+luNewMod+luNewPool;
  const luNewHP    = luNewBase*Math.pow(luNewLvl+10,2);
  const luReady    = luTotal === 2 && luGRoll !== null && !luDiceRolling;
  const confirmLU  = async () => {
    if (!luReady || luGRoll == null) return;
    if (characterId) {
      try {
        const { data } = await api.post(`/characters/${characterId}/level-up`, {
          attribute_points: {
            power:    luDist.Power    || 0,
            agility:  luDist.Agility  || 0,
            focus:    luDist.Focus    || 0,
            presence: luDist.Presence || 0,
          },
          chosen_attribute: luChosen.toLowerCase(),
          growth_roll: luGRoll,
        });
        setLevel(data.level);
        setAttrs({ Power: data.power, Agility: data.agility, Focus: data.focus, Presence: data.presence });
        setChosenAttr(cap(data.chosen_attribute));
        setGrowthPool(data.growth_pool_total);
        setCurRP(data.current_rp ?? data.base_rp);
        setBankRP(data.rp_banked ?? 0);
        setBanking(!!data.rp_banking);
        setCanCommitBank((Number(data.rp_banked) || 0) <= 0 && !data.rp_banking);
        setBankTempRemaining(0);
        setCurHP(Number(data.max_hp));
        setLuGRoll(data.growth_roll_this_level ?? null);
        setLuOpen(false);
      } catch(e) {
        console.error('[VelionSheet] Level-up API error:', e);
      }
      return;
    }
    // Standalone (no characterId) — local computation
    const newLvl=level+1, newAttrs=Object.fromEntries(ATTRS.map(a=>[a,attrs[a]+luDist[a]]));
    const newPool=growthPool+(luGRoll||0), newMod=calcMod(newAttrs[luChosen]);
    const newBase=newLvl+newMod+newPool, newMax=newBase*Math.pow(newLvl+10,2);
    setLevel(newLvl); setAttrs(newAttrs); setGrowthPool(newPool); setChosenAttr(luChosen);
    setCurRP(newBase); setCurHP(newMax); setLuOpen(false);
  };

  // ── Armor ──
  const [armor,      setArmor]     = useState(Object.fromEntries(ARMOR_SLOTS.map(s=>[s,mkArmor()])));
  const [armorModal, setArmorModal]= useState(null);
  const [armorDraft, setArmorDraft]= useState(null);
  /** `{ slot, items }` — multiple inventory armor pieces for one sheet slot */
  const [armorEquipPicker, setArmorEquipPicker] = useState(null);
  const openArmorEdit = (slot) => {
    setArmorEquipPicker(null);
    setArmorDraft({ ...armor[slot], resistances: { ...armor[slot].resistances } });
    setArmorModal(slot);
  };
  const applyArmor    = () => { setArmor(p=>({...p,[armorModal]:armorDraft})); setArmorModal(null); };
  const updDraftRes   = (el,v) => setArmorDraft(p=>({...p,resistances:{...p.resistances,[el]:Number(v)}}));
  const totalMit = ARMOR_SLOTS.reduce((s,sl)=>s+Number(armor[sl].mitigation),0);
  const totalRes = Object.fromEntries(ELEMENTS.map(el=>[el,ARMOR_SLOTS.reduce((s,sl)=>s+Number(armor[sl].resistances[el]),0)]));
  let effMit = totalMit;
  if(S.vulnerable) effMit=Math.max(0,Math.floor(totalMit*0.5));
  if(S.fortified)  effMit=Math.min(100,effMit+10);
  const effRes = Object.fromEntries(ELEMENTS.map(el=>{let v=totalRes[el];if(S.vulnerable)v=Math.max(0,Math.floor(v*0.5));return [el,v];}));
  const armorSaveSnap = useMemo(() => JSON.stringify(buildSheetArmorOverrides(armor)), [armor]);

  // ── Weapons ──
  const [weapons,   setWeapons]  = useState([]);
  const [specialAbilities, setSpecialAbilities] = useState([]);
  const [wepModal,  setWepModal] = useState(null);
  const [wepDraft,  setWepDraft] = useState(null);
  const [atkWeapon, setAtkWeapon]= useState(null);
  const openWepEdit  = w => { setWepDraft({...w,channels:w.channels.map(c=>({...c}))}); setWepModal('edit'); };
  const applyWepEdit = () => {
    setWeapons(p=>p.some(w=>w.id===wepDraft.id)?p.map(w=>w.id===wepDraft.id?wepDraft:w):[...p,wepDraft]);
    setWepModal(null); setWepDraft(null);
  };
  const delWeapon    = id => setWeapons(p=>p.filter(w=>w.id!==id));
  const addManualWep = () => { const w=mkWeapon(); setWepDraft({...w,channels:[...w.channels]}); setWepModal('edit'); };
  const draftAddCh   = () => setWepDraft(p=>({...p,channels:[...p.channels,{element:'Fire',dice:1}]}));
  const draftDelCh   = ci => setWepDraft(p=>({...p,channels:p.channels.filter((_,i)=>i!==ci)}));
  const draftUpdCh   = (ci,f,v) => setWepDraft(p=>({...p,channels:p.channels.map((c,i)=>i===ci?{...c,[f]:v}:c)}));

  // ── Attack (2-stage + overextend) ──
  const [atkStage,    setAtkStage]    = useState('stake');
  const [atkRP,       setAtkRP]       = useState(0);
  const [atkStaked,   setAtkStaked]   = useState(0);
  const [atkCritRoll, setAtkCritRoll] = useState(null);
  const [atkIsCrit,   setAtkIsCrit]   = useState(false);
  const [atkResult,   setAtkResult]   = useState(null);
  const atkStakedRef   = useRef(0);
  // Overextend
  const [oxOpen,   setOxOpen]   = useState(false);
  const [oxAmount, setOxAmount] = useState(0);
  const [oxRoll,   setOxRoll]   = useState(null);
  const [oxResult, setOxResult] = useState(null);
  const [tempRP,   setTempRP]   = useState(0);
  /** One overextend roll per attack open; blocks cancel-then-reroll and repeat attempts after success. */
  const [oxRolledThisAttack, setOxRolledThisAttack] = useState(false);
  /** Between End Turn and next Start Turn — weapon dice ×1, costs 1 RP, no overextend. */
  const [atkOppFlow, setAtkOppFlow] = useState(false);
  const [gemOppFlow, setGemOppFlow] = useState(false);

  const openAttack = (w, opportunity = false) => {
    resetDiceQueue();
    setAtkWeapon(w); setAtkRP(0); setAtkStaked(0); setAtkStage('stake');
    setAtkCritRoll(null); setAtkIsCrit(false);
    setAtkResult(null); setOxOpen(false); setOxAmount(0); setOxRoll(null); setOxResult(null); setTempRP(0);
    setOxRolledThisAttack(false);
    setAtkOppFlow(!!opportunity);
    atkStakedRef.current = 0;
    setWepModal('attack');
  };
  const doStake = () => {
    if (atkOppFlow) {
      if (curRP < 1) return;
      atkStakedRef.current = 1;
      setCurRP((p) => Math.max(0, p - 1));
      setAtkStaked(1);
      setAtkStage('roll');
      return;
    }
    const staked = atkRP + tempRP;
    atkStakedRef.current = staked;
    setCurRP(p=>Math.max(0,p-atkRP));
    setAtkStaked(staked);
    setAtkStage('roll');
  };
  // Stage 2a: roll d20 for crit first
  const doCritRoll = () => {
    const opp = atkOppFlow;
    requestSessionDiceRoll({
      formula: '1d20',
      label: opp
        ? `Opportunity — ${atkWeapon?.name || 'Weapon'} Attack`
        : `${atkWeapon?.name || 'Weapon'} Attack Roll`,
      source_label: charName || 'Character',
      requestMeta: { kind: 'atkCrit', opportunity: opp },
    });
  };
  // Stage 2b: roll damage dice — only available after crit roll
  const doDmgRoll = () => {
    if (!atkWeapon) return;
    const staked = atkStakedRef.current;
    const dmgMult = atkOppFlow ? 1 : staked;
    const sides = parseInt(atkWeapon.dieType.replace(/\D/g,'')) || 6;
    const isCrit = atkIsCrit;
    const channels = atkWeapon.channels.map(ch => ({
      element: ch.element,
      dice: ch.dice,
      nd: Number(ch.dice) || 1,
    }));
    weaponDmgCtxRef.current = {
      weapon: atkWeapon,
      channels,
      critRoll: atkCritRoll,
      isCrit,
      staked,
      /** Successful overextend only: temp RP granted → Overextended after this attack resolves. */
      tempRPFlag: !atkOppFlow && tempRP > 0,
      isOpportunity: atkOppFlow,
    };
    weaponDmgAccRef.current = new Array(channels.length).fill(null);
    const items = channels.map((ch, idx) => ({
      formula: `${ch.nd * (isCrit ? 2 : 1)}d${sides}`,
      label: atkOppFlow
        ? `Opportunity — ${atkWeapon.name} ${ch.element}`
        : `${atkWeapon.name} ${ch.element} Damage`,
      postMultiplier: dmgMult,
      source_label: charName || 'Character',
      requestMeta: { kind: 'weaponDmg', idx, count: channels.length },
    }));
    enqueueDiceRolls(items);
  };
  const closeAtk = () => {
    resetDiceQueue();
    setWepModal(null); setAtkWeapon(null);
    setAtkStage('stake'); setAtkRP(0); setAtkStaked(0);
    setAtkCritRoll(null); setAtkIsCrit(false); setAtkResult(null);
    setOxOpen(false); setOxAmount(0); setOxRoll(null); setOxResult(null); setTempRP(0);
    setOxRolledThisAttack(false);
    setAtkOppFlow(false);
  };
  const cancelPreStake = () => {
    resetDiceQueue();
    setWepModal(null); setAtkWeapon(null);
    setAtkStage('stake'); setAtkRP(0); setAtkStaked(0);
    setAtkCritRoll(null); setAtkIsCrit(false);
    setOxOpen(false); setOxAmount(0); setOxRoll(null); setOxResult(null); setTempRP(0);
    setOxRolledThisAttack(false);
    setAtkOppFlow(false);
  };
  // Post-stake cancel — RP already spent, just dismiss
  const cancelPostStake = () => {
    resetDiceQueue();
    setWepModal(null); setAtkWeapon(null);
    setAtkStage('stake'); setAtkRP(0); setAtkStaked(0);
    setAtkCritRoll(null); setAtkIsCrit(false);
    setOxOpen(false); setOxAmount(0); setOxRoll(null); setOxResult(null); setTempRP(0);
    setOxRolledThisAttack(false);
    setAtkOppFlow(false);
    if (tempRP > 0) setActive((p) => new Set([...p, 'Overextended']));
  };
  const rollOX = () => {
    const A = Math.max(0, Number(curRP) || 0);
    const oe = Math.min(Math.max(0, Number(oxAmount) || 0), A);
    if (oe <= 0 || A <= 0) return;
    const oxDC = calcOverextensionDC(oe, A);
    requestSessionDiceRoll({
      formula: '1d20',
      label: 'Overextend Check',
      source_label: charName || 'Character',
      requestMeta: { kind: 'oxCheck', oxAmount: oe, availableRP: A, oxDC },
    });
  };
  const confirmOX = () => setOxOpen(false);

  // ── Spell Gems ──
  const [bracerGrade, setBracerGrade] = useState('None');
  const [gems,        setGems]        = useState([]);
  // Create slots filled with empty sentinels — equipping is done from inventory
  const mkEmptyGem = () => ({ id: null, element: null, rarity: null, notes: '', num_dice: null, die_type: null });
  const changeBracer = g => {
    setBracerGrade(g);
    const n = BRACER_SLOTS[g];
    setGems(Array.from({length: n}, mkEmptyGem));
  };

  // ── Gem Attack ──
  const [gemAtkGem,      setGemAtkGem]     = useState(null);
  const [gemAtkStage,    setGemAtkStage]   = useState('stake');
  const [gemAtkRP,       setGemAtkRP]      = useState(0);
  const [gemAtkStaked,   setGemAtkStaked]  = useState(0);
  const [gemAtkCritRoll, setGemAtkCritRoll]= useState(null);
  const [gemAtkIsCrit,   setGemAtkIsCrit]  = useState(false);
  const [gemAtkResult,   setGemAtkResult]  = useState(null);
  const gemAtkStakedRef  = useRef(0);
  const gemDragValRef    = useRef(0);
  const gemFillRef       = useRef(null);
  const gemThumbRef      = useRef(null);

  const openGemAttack = (gem, opportunity = false) => {
    resetDiceQueue();
    setGemAtkGem(gem); setGemAtkRP(0); setGemAtkStaked(0); setGemAtkStage('stake');
    setGemAtkCritRoll(null); setGemAtkIsCrit(false); setGemAtkResult(null);
    setGemOppFlow(!!opportunity);
    gemAtkStakedRef.current = 0;
    setWepModal('gemAttack');
  };
  const doGemStake = () => {
    if (gemOppFlow) {
      if (curRP < 1) return;
      gemAtkStakedRef.current = 1;
      setCurRP((p) => Math.max(0, p - 1));
      setGemAtkStaked(1);
      setGemAtkStage('roll');
      return;
    }
    const staked = gemAtkRP;
    gemAtkStakedRef.current = staked;
    setCurRP(p => Math.max(0, p - staked));
    setGemAtkStaked(staked);
    setGemAtkStage('roll');
  };
  const doGemCritRoll = () => {
    const opp = gemOppFlow;
    requestSessionDiceRoll({
      formula: '1d20',
      label: opp
        ? `Opportunity — ${gemAtkGem?.element || 'Spell'}`
        : `${gemAtkGem?.element || 'Spell'} Attack Roll`,
      source_label: charName || 'Character',
      requestMeta: { kind: 'gemCrit', opportunity: opp },
    });
  };
  const doGemRoll = () => {
    if (!gemAtkGem) return;
    const staked = gemAtkStakedRef.current;
    const nd  = Number(gemAtkGem.num_dice) || 1;
    const dt  = Number(gemAtkGem.die_type)  || 6;
    const baseMult = gemOppFlow ? 1 : staked;
    gemDmgCtxRef.current = { gem: gemAtkGem, staked, nd, dt, isCrit: gemAtkIsCrit, isOpportunity: gemOppFlow };
    gemDmgAccRef.current = [null];
    requestSessionDiceRoll({
      formula: `${nd}d${dt}`,
      label: gemOppFlow
        ? `Opportunity — ${gemAtkGem.element} Spell`
        : `${gemAtkGem.element} Spell Damage`,
      postMultiplier: baseMult * (gemAtkIsCrit ? 2 : 1),
      source_label: charName || 'Character',
      requestMeta: { kind: 'gemDmg', idx: 0, count: 1 },
    });
  };
  const closeGemAtk = () => {
    resetDiceQueue();
    setWepModal(null); setGemAtkGem(null);
    setGemAtkStage('stake'); setGemAtkRP(0); setGemAtkStaked(0);
    setGemAtkCritRoll(null); setGemAtkIsCrit(false); setGemAtkResult(null);
    setGemOppFlow(false);
  };

  /** Local 3D dice always emit this — must not depend on VTT socket (`sessionId` / `SOCKET_URL`). */
  const handleDiceRollComplete = useCallback((event) => {
    const detail = event?.detail;
    const meta = detail?.requestMeta;
    const num = (v) => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    if (meta?.kind === 'atkCrit') {
      const r = num(detail.results?.[0] ?? detail.total);
      setAtkCritRoll(r);
      setAtkIsCrit(r === 20);
    } else if (meta?.kind === 'gemCrit') {
      const r = num(detail.results?.[0] ?? detail.total);
      setGemAtkCritRoll(r);
      setGemAtkIsCrit(r === 20);
    } else if (meta?.kind === 'oxCheck') {
      const r = num(detail.results?.[0] ?? detail.total);
      const amt = typeof meta.oxAmount === 'number' ? meta.oxAmount : 0;
      const A = typeof meta.availableRP === 'number' ? meta.availableRP : 0;
      const dc =
        typeof meta.oxDC === 'number'
          ? meta.oxDC
          : calcOverextensionDC(amt, A);
      setOxRoll(r);
      setOxRolledThisAttack(true);
      if (r >= dc) {
        setOxResult('success');
        setTempRP(amt);
      } else {
        setOxResult('fail');
        setTempRP(0);
      }
    } else if (meta?.kind === 'weaponDmg') {
      const ctx = weaponDmgCtxRef.current;
      if (ctx?.weapon) {
        const idx = Number(meta.idx);
        const sum = (detail.results || []).reduce((s, n) => s + n, 0);
        weaponDmgAccRef.current[idx] = {
          element: ctx.channels[idx].element,
          dice: ctx.channels[idx].dice,
          rolls: detail.results || [],
          sum,
          dmg: detail.total,
        };
        if (weaponDmgAccRef.current.length === meta.count && weaponDmgAccRef.current.every(Boolean)) {
          setAtkResult({
            chs: weaponDmgAccRef.current,
            critRoll: ctx.critRoll,
            isCrit: ctx.isCrit,
            rpUsed: ctx.staked,
          });
          if (ctx.tempRPFlag) setActive((p) => new Set([...p, 'Overextended']));
          weaponDmgCtxRef.current = null;
        }
      }
    } else if (meta?.kind === 'gemDmg') {
      const ctx = gemDmgCtxRef.current;
      if (ctx?.gem) {
        const idx = Number(meta.idx);
        gemDmgAccRef.current[idx] = {
          rolls: detail.results || [],
          sum: (detail.results || []).reduce((s, n) => s + n, 0),
          dmg: detail.total,
        };
        if (gemDmgAccRef.current.length === meta.count && gemDmgAccRef.current.every(Boolean)) {
          const staked = ctx.staked;
          const nd = ctx.nd;
          const dt = ctx.dt;
          const isCrit = ctx.isCrit;
          const rolls = gemDmgAccRef.current[0].rolls;
          const sum = gemDmgAccRef.current[0].sum;
          const dmg = gemDmgAccRef.current[0].dmg;
          setGemAtkResult({ rolls, sum, dmg, rpUsed: staked, nd, dt, isCrit });
          gemDmgCtxRef.current = null;
        }
      }
    }
    rollLockRef.current = false;
    rollQueueRef.current.shift();
    const nextPump = () => {
      if (rollQueueRef.current.length === 0) return;
      const next = rollQueueRef.current[0];
      if (!next) return;
      rollLockRef.current = true;
      window.dispatchEvent(new CustomEvent('velion:dice-roll-request', { detail: { ...next, autoOpen: false } }));
    };
    nextPump();
  }, []);

  useEffect(() => {
    window.addEventListener('velion:dice-roll-complete', handleDiceRollComplete);
    return () => window.removeEventListener('velion:dice-roll-complete', handleDiceRollComplete);
  }, [handleDiceRollComplete]);

  // ── Factions ──
  const [factions, setFactions] = useState([mkFaction()]);
  const addFaction = ()        => setFactions(p=>[...p,mkFaction()]);
  const delFaction = id        => setFactions(p=>p.filter(f=>f.id!==id));
  const updFaction = (id,f,v) => setFactions(p=>p.map(x=>x.id===id?{...x,[f]:v}:x));
  const adjFavor   = (id,d)   => setFactions(p=>p.map(x=>x.id===id?{...x,favor:Math.max(-100,Math.min(100,x.favor+d))}:x));
  const [notes, setNotes] = useState('');

  // ── DB integration state ──
  const initialized  = useRef(false);
  const skipSaves    = useRef(true);   // suppress auto-save during initialization
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saving' | 'saved' | 'error'

  // ── Library browser state ──
  const [libWeapons,      setLibWeapons]      = useState([]);
  const [libArmor,        setLibArmor]        = useState([]);
  const [libGems,         setLibGems]         = useState([]);
  const [libGenItems,     setLibGenItems]     = useState([]);
  const [libBracers,      setLibBracers]      = useState([]);
  const [libLoading,      setLibLoading]      = useState(false);
  const [libSearch,       setLibSearch]       = useState('');
  const [libRarityFilter, setLibRarityFilter] = useState('');
  const [libElemFilter,   setLibElemFilter]   = useState('');
  const [libSlotFilter,   setLibSlotFilter]   = useState('');
  const [libCatFilter,    setLibCatFilter]    = useState('');
  const [gemTargetSlot,   setGemTargetSlot]   = useState(0);
  const [armorTargetSlot, setArmorTargetSlot] = useState('Helmet');
  const [libExpanded,     setLibExpanded]     = useState(null);
  const [libShowMine,     setLibShowMine]     = useState(false);

  // ── Inventory state ──
  const [inventory,    setInventory]   = useState([]);  // [{...inv_row, item_details:{...}}]
  const [invLoading,   setInvLoading]  = useState(false);

  // ── Pets / Companions ──────────────────────────────────────────────────
  const [charPets,     setCharPets]    = useState([]);  // [{...bond, pet:{...petRow, attacks:[]}}]
  const [petLoading,   setPetLoading]  = useState(false);
  const [libPetSearch, setLibPetSearch]= useState('');
  const [libPetItems,  setLibPetItems] = useState([]);
  const [libPetLoading,setLibPetLoading]=useState(false);

  const fetchPets = () => {
    if (!characterId) return;
    setPetLoading(true);
    api.get(`/characters/${characterId}/pets`)
      .then(r => { setCharPets(r.data.data || []); setPetLoading(false); })
      .catch(() => setPetLoading(false));
  };
  const bondPet = (pet_id) => {
    if (!characterId) return;
    api.post(`/characters/${characterId}/pets`, { pet_id })
      .then(r => { setCharPets(p => [...p, r.data]); setWepModal(null); })
      .catch(console.error);
  };
  const updatePetHP = (bondId, delta) => {
    const bond = charPets.find(b => b.id === bondId);
    if (!bond) return;
    const newHP = Math.max(0, Math.min(Number(bond.pet?.max_hp || 0), Number(bond.current_hp) + delta));
    api.patch(`/characters/${characterId}/pets/${bondId}`, { current_hp: newHP })
      .then(() => setCharPets(p => p.map(b => b.id === bondId ? { ...b, current_hp: newHP } : b)))
      .catch(console.error);
  };
  const updatePetNickname = (bondId, nickname) => {
    setCharPets(p => p.map(b => b.id === bondId ? { ...b, nickname } : b));
    api.patch(`/characters/${characterId}/pets/${bondId}`, { nickname }).catch(console.error);
  };
  const removePet = (bondId) => {
    api.delete(`/characters/${characterId}/pets/${bondId}`)
      .then(() => setCharPets(p => p.filter(b => b.id !== bondId)))
      .catch(console.error);
  };
  const [invEquipSlot, setInvEquipSlot]= useState({}); // itemId -> slot string for slot picker

  const fetchInventory = () => {
    if (!characterId) return;
    setInvLoading(true);
    api.get(`/inventory/${characterId}`)
      .then(r => { setInventory(r.data.data); setInvLoading(false); })
      .catch(() => setInvLoading(false));
  };

  useEffect(() => {
    if (!characterId) return;
    fetchInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load inventory when switching character; fetchInventory is stable enough
  }, [characterId]);

  const addToInventory = (item_type, library_item_id) => {
    if (!characterId) return;
    api.post(`/inventory/${characterId}`, { item_type, library_item_id })
      .then(() => fetchInventory())
      .catch((err) => {
        const e = extractApiError(err);
        if (e.status === 422) window.alert(e.message);
        else console.error(err);
      });
  };

  const meetsWeaponLibStats = (w) =>
    w &&
    attrs.Power >= (Number(w.req_power) || 0) &&
    attrs.Agility >= (Number(w.req_agility) || 0) &&
    attrs.Focus >= (Number(w.req_focus) || 0);

  const meetsArmorLibStats = (a) => a && attrs.Power >= (Number(a.req_power) || 0);

  const meetsBracerLibStats = (b) => b && attrs.Focus >= (Number(b.req_focus) || 0);

  const meetsEquipStatRequirements = (itemType, det) => {
    if (!det) return true;
    if (itemType === 'weapon') return meetsWeaponLibStats(det);
    if (itemType === 'armor') return meetsArmorLibStats(det);
    if (itemType === 'focus_bracer') return meetsBracerLibStats(det);
    return true;
  };

  const equipStatRequirementMessage = (itemType, det) => {
    if (!det || meetsEquipStatRequirements(itemType, det)) return '';
    if (itemType === 'weapon') {
      const rp = Number(det.req_power) || 0;
      const ra = Number(det.req_agility) || 0;
      const rf = Number(det.req_focus) || 0;
      return `Requires Power ${rp}, Agility ${ra}, Focus ${rf}. You have Power ${attrs.Power}, Agility ${attrs.Agility}, Focus ${attrs.Focus}.`;
    }
    if (itemType === 'armor') {
      const rp = Number(det.req_power) || 0;
      return `Requires Power ${rp}. Your Power is ${attrs.Power}.`;
    }
    if (itemType === 'focus_bracer') {
      const rf = Number(det.req_focus) || 0;
      return `Requires Focus ${rf}. Your Focus is ${attrs.Focus}.`;
    }
    return '';
  };

  const equipInventoryItem = (invItem, slot) => {
    if (!characterId) return;
    if (!meetsEquipStatRequirements(invItem.item_type, invItem.item_details)) {
      window.alert(equipStatRequirementMessage(invItem.item_type, invItem.item_details) || 'You do not meet this item’s attribute requirements.');
      return;
    }
    api.patch(`/inventory/${characterId}/${invItem.id}`, { equipped: true, equipped_slot: slot })
      .then(r => {
        setInventory(p => p.map(x => x.id === invItem.id ? { ...r.data } : x));
        const det = r.data.item_details;
        if (!det) return;
        if (invItem.item_type === 'weapon') {
          const sheetW = libWeaponToSheet(det);
          setWeapons(p => [...p.filter(x => x.id !== sheetW.id), sheetW]);
        }
        if (invItem.item_type === 'armor') {
          setArmor(p => ({
            ...p,
            [cap(det.slot)]: mergeArmorSheetOverrides(libArmorToSheet(det), cap(det.slot), armorOverrides),
          }));
        }
        if (invItem.item_type === 'focus_bracer') {
          changeBracer(cap(det.grade));
        }
        if (invItem.item_type === 'spell_gem') {
          const slotIdx = parseInt(slot.replace('bracer_gem_', ''));
          if (!isNaN(slotIdx)) {
            const newGem = {
              id: det.id,
              element: libGemElement(det.element_type),
              rarity: cap(det.rarity),
              notes: det.secondary_effect || '',
              num_dice: det.num_dice || 1,
              die_type: det.die_type || 6,
            };
            setGems(p => {
              const n = [...p];
              while (n.length <= slotIdx) n.push(mkEmptyGem());
              n[slotIdx] = newGem;
              return n;
            });
          }
        }
      })
      .catch((err) => {
        const e = extractApiError(err);
        if (e.status === 422) window.alert(e.message);
        else console.error(err);
      });
  };

  const getArmorInventoryCandidates = (sheetSlot) =>
    inventory.filter(
      (inv) =>
        inv.item_type === 'armor' &&
        !inv.equipped &&
        inv.item_details &&
        cap(inv.item_details.slot) === sheetSlot &&
        meetsEquipStatRequirements('armor', inv.item_details),
    );

  const findEquippedArmorInventoryForSlot = (sheetSlot) =>
    inventory.find(
      (inv) =>
        inv.item_type === 'armor' &&
        inv.equipped &&
        inv.item_details &&
        cap(inv.item_details.slot) === sheetSlot,
    ) ?? null;

  const handleArmorSlotEquipPress = (sheetSlot) => {
    if (!characterId) return;
    const candidates = getArmorInventoryCandidates(sheetSlot);
    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      const inv = candidates[0];
      equipInventoryItem(inv, inv.item_details.slot);
      return;
    }
    setArmorEquipPicker({ slot: sheetSlot, items: candidates });
  };

  const unequipInventoryItem = (invItem) => {
    setArmorEquipPicker(null);
    if (!characterId) return;
    api.patch(`/inventory/${characterId}/${invItem.id}`, { equipped: false, equipped_slot: null })
      .then(r => {
        setInventory(p => p.map(x => x.id === invItem.id ? { ...r.data } : x));
        const det = r.data.item_details;
        if (!det) return;
        if (invItem.item_type === 'weapon') setWeapons(p => p.filter(x => x.id !== det.id));
        if (invItem.item_type === 'armor')  setArmor(p => ({ ...p, [cap(det.slot)]: mkArmor() }));
        if (invItem.item_type === 'focus_bracer') changeBracer('None');
        if (invItem.item_type === 'spell_gem' && invItem.equipped_slot) {
          const slotIdx = parseInt(invItem.equipped_slot.replace('bracer_gem_', ''));
          if (!isNaN(slotIdx)) {
            setGems(p => {
              const n = [...p];
              if (n[slotIdx] !== undefined) n[slotIdx] = mkEmptyGem();
              return n;
            });
          }
        }
      })
      .catch(console.error);
  };

  const removeFromInventory = (invItem) => {
    if (!characterId) return;
    api.delete(`/inventory/${characterId}/${invItem.id}`)
      .then(() => {
        setInventory(p => p.filter(x => x.id !== invItem.id));
        if (invItem.equipped && invItem.item_details) {
          if (invItem.item_type === 'weapon') setWeapons(p => p.filter(x => x.id !== invItem.item_details.id));
          if (invItem.item_type === 'armor')  setArmor(p => ({ ...p, [cap(invItem.item_details.slot)]: mkArmor() }));
        }
      })
      .catch(console.error);
  };

  const updateInvQty = (invItem, delta) => {
    const newQty = Math.max(0, invItem.quantity + delta);
    if (newQty === 0) { removeFromInventory(invItem); return; }
    if (!characterId) return;
    api.patch(`/inventory/${characterId}/${invItem.id}`, { quantity: newQty })
      .then(r => setInventory(p => p.map(x => x.id === invItem.id ? { ...r.data } : x)))
      .catch(console.error);
  };

  // ── Damage Modal ──
  const [dModal,    setDModal]   = useState(null);
  const [dmgLines,  setDmgLines] = useState([{amount:'',type:'Physical'}]);
  const [dmgResult, setDmgResult]= useState(null);
  const [healAmt,   setHealAmt]  = useState('');
  const openDmg  = () => { setDmgLines([{amount:'',type:'Physical'}]); setDmgResult(null); setDModal('damage'); };
  const openHeal = () => { setHealAmt(''); setDModal('heal'); };

  const openAbilityUse = (ability, opportunity = false) => {
    if (ability.resolution_model === 'weapon_like') {
      openAttack(abilityAsWeapon(ability), opportunity);
    } else if (ability.resolution_model === 'gem_like') {
      openGemAttack(abilityAsGem(ability), opportunity);
    } else if (ability.resolution_model === 'healing') {
      openHeal();
    }
  };

  // ── DB Integration Effects ────────────────────────────────────────────────

  // 1. Initialize local state from API data (fires once when initialData arrives)
  useEffect(() => {
    if (!initialData || initialized.current) return;
    initialized.current = true;
    setCharName(initialData.name || '');
    setLevel(initialData.level || 1);
    setAttrs({
      Power:    initialData.power    || 10,
      Agility:  initialData.agility  || 10,
      Focus:    initialData.focus    || 10,
      Presence: initialData.presence || 10,
    });
    setChosenAttr(cap(initialData.chosen_attribute || 'power'));
    setGrowthPool(initialData.growth_pool_total || 0);
    const maxHp = Number(initialData.max_hp) || 0;
    setCurHP(Number(initialData.current_hp) || maxHp);
    setCurRP(initialData.current_rp ?? initialData.base_rp ?? 1);
    setBankRP(initialData.rp_banked ?? 0);
    setBanking(!!initialData.rp_banking);
    setCanCommitBank((Number(initialData.rp_banked) || 0) <= 0 && !initialData.rp_banking);
    setGold(initialData.gold || 0);
    setNotes(initialData.notes || '');
    if (initialData.portrait_url) setPortrait(initialData.portrait_url);
    if (Array.isArray(initialData.special_abilities)) {
      setSpecialAbilities(initialData.special_abilities);
    }
    // Allow auto-save after a tick (state setters are async)
    setTimeout(() => { skipSaves.current = false; }, 200);
  }, [initialData]);

  useEffect(() => {
    if (!initialized.current || initialData == null) return;
    if (initialData.portrait_url) setPortrait(initialData.portrait_url);
  }, [initialData?.portrait_url]);

  useEffect(() => {
    if (!characterId || !initialData?.portrait_url) return;
    let cancelled = false;
    void (async () => {
      const renderUrl = await getPortraitRenderUrl(characterId, initialData.portrait_url);
      if (!cancelled && renderUrl) setPortrait(renderUrl);
    })();
    return () => { cancelled = true; };
  }, [characterId, getPortraitRenderUrl, initialData?.portrait_url]);

  // 2. Hydrate equipment from API data (weapons, armor, bracer, gems)
  useEffect(() => {
    if (!initialData || !initialized.current) return;
    const { equipment = [], bracer_gems = [] } = initialData;
    if (!equipment.length && !bracer_gems.length) return;

    const hydrate = async () => {
      try {
        // Weapons
        const weaponEquip = equipment.filter(e => e.item_type === 'weapon');
        if (weaponEquip.length) {
          const items = await Promise.all(
            weaponEquip.map(e => api.get(`/library/weapons/${e.item_id}`).then(r => r.data))
          );
          setWeapons(items.map(libWeaponToSheet));
        }

        // Armor
        const armorEquip = equipment.filter(e => e.item_type === 'armor');
        if (armorEquip.length) {
          const items = await Promise.all(
            armorEquip.map(e => api.get(`/library/armor/${e.item_id}`).then(r => r.data))
          );
          const newArmor = Object.fromEntries(ARMOR_SLOTS.map(s => [s, mkArmor()]));
          items.forEach(a => {
            const slot = cap(a.slot);
            if (newArmor[slot]) {
              newArmor[slot] = mergeArmorSheetOverrides(libArmorToSheet(a), slot, armorOverrides);
            }
          });
          setArmor(newArmor);
        }

        // Focus bracer
        const bracerEquip = equipment.find(e => e.item_type === 'focus_bracer');
        if (bracerEquip) {
          const b = await api.get(`/library/focus-bracers/${bracerEquip.item_id}`).then(r => r.data);
          changeBracer(cap(b.grade));
        }

        // Bracer gems — read from inventory (equipped_slot is source of truth), not bracer_gems table
        if (characterId) {
          const invData = await api.get(`/inventory/${characterId}`).then(r => r.data.data || []);
          setInventory(invData);

          const equippedGems = invData.filter(
            inv => inv.item_type === 'spell_gem' && inv.equipped && inv.equipped_slot
          );

          if (equippedGems.length) {
            // Determine bracer grade for slot count (may already be set above)
            const grade = bracerEquip
              ? cap((await api.get(`/library/focus-bracers/${bracerEquip.item_id}`).then(r => r.data)).grade)
              : 'None';
            const slotCount = BRACER_SLOTS[grade] || 0;
            const newGems = Array.from({ length: slotCount }, mkEmptyGem);

            for (const inv of equippedGems) {
              const slotIdx = parseInt(inv.equipped_slot.replace('bracer_gem_', ''));
              if (!isNaN(slotIdx) && slotIdx < newGems.length && inv.item_details) {
                const det = inv.item_details;
                newGems[slotIdx] = {
                  id:       det.id,
                  element:  libGemElement(det.element_type),
                  rarity:   cap(det.rarity),
                  notes:    det.secondary_effect || '',
                  num_dice: det.num_dice || 1,
                  die_type: det.die_type || 6,
                };
              }
            }
            setGems(newGems);
          }
          // Fetch pets
          if (characterId) {
            api.get(`/characters/${characterId}/pets`)
              .then(r => setCharPets(r.data.data || []))
              .catch(console.warn);
          }
        }
      } catch (e) {
        console.warn('[VelionSheet] Equipment hydration error:', e);
      }
    };
    hydrate();
  // Re-hydrate library gear only when equipped items change — not on every HP/RP refetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, equipmentSig]);

  // 2b. When the server row changes (VTT spent RP, refetch, etc.), sync session RP
  const rpSyncRef = useRef({ characterId: null, rev: null });
  useEffect(() => {
    if (!initialData || !characterId || !initialized.current) return;
    const prevCharId = rpSyncRef.current.characterId;
    if (prevCharId !== characterId) {
      rpSyncRef.current = { characterId, rev: null };
    }
    const rev =
      initialData.updated_at ??
      `${initialData.current_rp}:${initialData.rp_banked}:${initialData.rp_banking}:${initialData.base_rp}`;
    if (rpSyncRef.current.rev === rev) return;
    rpSyncRef.current.rev = rev;
    setCurRP(initialData.current_rp ?? initialData.base_rp ?? 1);
    setBankRP(initialData.rp_banked ?? 0);
    setBanking(!!initialData.rp_banking);
    if (prevCharId !== characterId) {
      setCanCommitBank((Number(initialData.rp_banked) || 0) <= 0 && !initialData.rp_banking);
      setBankTempRemaining(0);
    }
  }, [characterId, initialData?.updated_at, initialData?.current_rp, initialData?.rp_banked, initialData?.rp_banking, initialData?.base_rp]);

  // 3. Auto-save debounce — fires 3s after any saveable field changes
  const saveTimer = useRef(null);
  useEffect(() => {
    if (!characterId || skipSaves.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await api.patch(`/characters/${characterId}`, {
          name:       charName,
          current_hp: curHP,
          gold,
          notes,
          current_rp: curRP,
          rp_banked:  bankRP,
          rp_banking: banking,
          sheet_armor_overrides: buildSheetArmorOverrides(armor),
        });
        queryClient.invalidateQueries({ queryKey: characterKeys.detail(characterId) });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus(null), 2500);
      } catch {
        setSaveStatus('error');
      }
    }, 3000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterId, charName, curHP, gold, notes, curRP, bankRP, banking, armorSaveSnap]);

  // Stable callbacks to avoid focus loss in damage inputs
  const setDmgAmount = useCallback((idx,val) => {
    setDmgLines(p=>p.map((d,i)=>i===idx?{...d,amount:val}:d));
    setDmgResult(null);
  },[]);
  const setDmgType = useCallback((idx,val) => {
    setDmgLines(p=>p.map((d,i)=>i===idx?{...d,type:val}:d));
    setDmgResult(null);
  },[]);

  const computeDmg = () => {
    const res=[]; let net=0;
    for(const e of dmgLines){
      const amt=Number(e.amount); if(!amt) continue;
      if(e.type==='Physical'){
        const m=Math.min(effMit,100),final=Math.round(amt*(1-m/100));
        res.push({label:`${fmtNum(amt)} Physical`,detail:`${m}% mit → ${fmtNum(final)} taken`,change:-final,color:T.text});
        net-=final;
      } else {
        const r=effRes[e.type]||0;
        if(r>=100){ const heal=Math.round(amt*(r-100)/100); res.push({label:`${fmtNum(amt)} ${e.type}`,detail:`${r}% res — absorbed${heal?`, +${fmtNum(heal)} healed`:''}`,change:heal,color:ELEM_COLOR[e.type],heal:true}); net+=heal; }
        else { const final=Math.round(amt*(1-r/100)); res.push({label:`${fmtNum(amt)} ${e.type}`,detail:`${r}% res → ${fmtNum(final)} taken`,change:-final,color:ELEM_COLOR[e.type]}); net-=final; }
      }
    }
    setDmgResult({res,net});
  };
  const confirmDmg  = () => { if(dmgResult) setCurHP(p=>Math.max(0,Math.min(maxHP,p+dmgResult.net))); setDModal(null); };
  const confirmHeal = () => { const a=Number(healAmt); if(a>0) setCurHP(p=>Math.min(maxHP,p+a)); setDModal(null); };

  // ── Display ──
  const hpPct    = maxHP>0     ? Math.min(100,Math.max(0,curHP/maxHP*100))     : 0;
  const rpPct    = effBaseRP>0 ? Math.min(100,Math.max(0,curRP/effBaseRP*100)) : 0;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'EB Garamond',serif",fontSize: '18px',color:T.text,background:T.bg,minHeight:'100vh',padding:'20px',maxWidth:'1350px',margin:'0 auto'}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input,select,textarea{font-family:inherit;font-size:inherit;transition:border-color 0.15s}
        input:focus,select:focus,textarea:focus{border-color:#c4922a!important;outline:none}
        select{appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%23c4922a'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center;padding-right:24px!important;cursor:pointer}
        select option{background:#0d1018}
        button{font-family:inherit;cursor:pointer;transition:all 0.15s}
        button:hover{opacity:0.75}
        button:disabled{opacity:0.28;cursor:not-allowed}
        input[type=range]{-webkit-appearance:none;appearance:none;background:transparent;width:100%;cursor:pointer}
        input[type=range]::-webkit-slider-track{height:5px;background:#1c2030;border-radius:3px}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#c4922a;margin-top:-7px;cursor:pointer;box-shadow:0 0 6px #c4922a55}
        ::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:#080a10}::-webkit-scrollbar-thumb{background:#2a2e3a;border-radius:3px}
        .tr-hover:hover td{background:#0f1220!important}
      `}</style>

      {/* ══ TITLE ════════════════════════════════════════════════════════ */}
      <div style={{textAlign:'center',marginBottom:'14px',paddingBottom:'14px',borderBottom:`1px solid ${T.border}`}}>
        <img
          src="/velion_wordmark.png"
          alt="Velion Mythera"
          style={{display:'block',height:'50px',width:'auto',margin:'0 auto 4px'}}
        />
        <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.4em',color:T.textMuted,marginTop:'3px'}}>CHARACTER SHEET</div>
      </div>

      {/* ══ ACTION BAR ═══════════════════════════════════════════════════ */}
      <div style={{display:'flex',gap:'8px',marginBottom:'14px',alignItems:'center',flexWrap:'wrap',background:T.surface,border:`1px solid ${T.border}`,borderRadius:'4px',padding:'10px 14px'}}>
        <button
          onClick={handleTurnStart}
          disabled={inActiveTurn}
          style={{...Btn('#50a0e8'),padding:'8px 20px',fontSize: '15px',background:'#060e1a',letterSpacing:'0.14em',fontWeight:'600'}}
        >▶ START TURN</button>
        <button
          onClick={handleEndTurn}
          disabled={!inActiveTurn}
          style={{...Btn('#c8503a'),padding:'8px 20px',fontSize: '15px',background:'#1a0806',letterSpacing:'0.12em',fontWeight:'600'}}
        >■ END TURN</button>
        {inActiveTurn && (
          <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,letterSpacing:'0.08em'}}>End turn when your round is over — then you can start the next.</span>
        )}
        {banking&&bankRP>0&&<span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:'#4a8dcc'}}>+{bankRP} banked RP ready</span>}
        <div style={{flex:1}}/>
        <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,letterSpacing:'0.1em'}}>REST:</span>
        <button onClick={handleShortRest} style={{...Btn('#c89830'),padding:'8px 16px',fontSize: '14px'}}>⏱ SHORT</button>
        <button onClick={handleLongRest}  style={{...Btn('#7060a8'),padding:'8px 16px',fontSize: '14px'}}>🌙 LONG</button>
        {saveStatus&&(
          <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.1em',
            color:saveStatus==='saved'?'#3dba6a':saveStatus==='error'?'#e05050':'#706858'}}>
            {saveStatus==='saving'?'● SAVING…':saveStatus==='saved'?'✓ SAVED':saveStatus==='error'?'✕ SAVE ERROR':''}
          </span>
        )}
      </div>

      {/* ══ IDENTITY ═════════════════════════════════════════════════════ */}
      <div style={{display:'grid',gridTemplateColumns:'130px 1fr',gap:'16px',marginBottom:'14px'}}>
        <div>
          <div
            onClick={() => { if (!portraitUploading) portRef.current?.click(); }}
            style={{
              width:'130px',
              height:'160px',
              background:T.surface,
              border:`1px solid ${T.border}`,
              borderRadius:'4px',
              display:'flex',
              flexDirection:'column',
              alignItems:'center',
              justifyContent:'center',
              cursor: portraitUploading ? 'wait' : 'pointer',
              overflow:'hidden',
              opacity: portraitUploading ? 0.72 : 1,
              position:'relative',
            }}
          >
            {portrait?<img src={portrait} style={{width:'100%',height:'100%',objectFit:'cover'}} alt="portrait"/>
              :<><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#2a2e3a" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              <span style={{fontFamily:"'Cinzel',serif",fontSize: '12px',letterSpacing:'0.12em',color:'#2a2e3a',marginTop:'8px'}}>PORTRAIT</span>
              <span style={{fontFamily:"'Cinzel',serif",fontSize: '12px',color:'#1a1c28',marginTop:'3px'}}>{characterId ? 'CLICK TO UPLOAD' : 'LOCAL PREVIEW'}</span></>}
            {portraitUploading && (
              <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(6,8,12,0.75)',fontFamily:"'Cinzel',serif",fontSize: '12px',letterSpacing:'0.14em',color:T.gold}}>
                UPLOADING…
              </div>
            )}
          </div>
          <input ref={portRef} type="file" accept="image/png,image/jpeg,image/webp,image/*" onChange={onPort} style={{display:'none'}}/>
          {(portraitErr || (!characterId && portrait)) && (
            <div style={{ fontSize: '12px', color: portraitErr ? '#e05050' : T.textDim, marginTop: '6px', maxWidth: '130px', lineHeight: 1.35 }}>
              {portraitErr || (!characterId && portrait ? 'Save character to cloud to persist portrait.' : '')}
            </div>
          )}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          <Fld label="Character Name">
            <input value={charName} onChange={e=>setCharName(e.target.value)} placeholder="Enter character name…"
              style={{...inp(),fontSize: '24px',fontWeight:'500',padding:'7px 12px',borderColor:`${T.gold}44`}}/>
          </Fld>
          <div style={{display:'grid',gridTemplateColumns:'auto 1fr 1fr 1fr',gap:'10px',alignItems:'end'}}>
            <div>
              <label style={LBL}>Level</label>
              <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                <div style={{background:T.surface,border:`1px solid ${T.gold}55`,borderRadius:'3px',padding:'5px 14px',fontSize: '25px',fontWeight:'700',color:T.gold,minWidth:'60px',textAlign:'center'}}>{level}</div>
                {characterId && (
                  <>
                    <button type="button" onClick={()=>setProgFlow('set-level')} style={{...Btn(T.gold),padding:'5px 8px',fontSize: '11px',whiteSpace:'nowrap',background:`${T.gold}11`}}>SET LEVEL</button>
                    <button type="button" onClick={openLevelUp} style={{...Btn(T.gold),padding:'5px 8px',fontSize: '11px',whiteSpace:'nowrap',background:`${T.gold}11`}}>▲ +1</button>
                  </>
                )}
              </div>
              {characterId && (
                <button type="button" onClick={()=>setProgFlow('edit-origin')} style={{...Btn(T.textMuted),padding:'4px 0',fontSize: '11px',marginTop:'6px',border:'none',letterSpacing:'0.1em'}}>
                  EDIT ORIGIN & PROGRESSION
                </button>
              )}
            </div>
            {/* Chosen attribute — read-only reference, only settable in level-up */}
            <div>
              <label style={LBL}>Chosen Attribute</label>
              <div style={{background:T.surface,border:`1px solid ${ATTR_COLOR[chosenAttr]}44`,borderRadius:'3px',padding:'6px 12px',fontSize: '19px',fontWeight:'600',color:ATTR_COLOR[chosenAttr]}}>{chosenAttr}</div>
            </div>
            <Fld label="Gold (G)">
              <input value={gold} onChange={e=>setGold(Number(e.target.value.replace(/\D/g,''))||0)} style={{...inp(),color:T.gold}}/>
            </Fld>
            <Fld label="Concept / Trait">
              <input value={concept} onChange={e=>setConcept(e.target.value)} placeholder="Brief concept…" style={inp()}/>
            </Fld>
          </div>
        </div>
      </div>

      {/* ══ CORE STATS ═══════════════════════════════════════════════════ */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px',marginBottom:'14px'}}>

        {/* ── Attributes ── */}
        <div style={crd(T.gold)}>
          <SecTitle>Attributes</SecTitle>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'10px'}}>
            {ATTRS.map(attr=>{
              const val=attrs[attr],mod=calcMod(val),chosen=attr===chosenAttr;
              return(
                <button key={attr}
                  onClick={()=>rollSave(attr)}
                  onContextMenu={e=>{e.preventDefault();setCtxMenu({attr,x:e.clientX,y:e.clientY});}}
                  style={{background:chosen?`${ATTR_COLOR[attr]}14`:T.surface,border:`1px solid ${chosen?ATTR_COLOR[attr]+'66':T.border}`,borderRadius:'3px',padding:'10px',textAlign:'center',position:'relative',cursor:'pointer',transition:'all 0.15s',outline:'none',fontFamily:'inherit'}}>
                  {chosen&&<span style={{position:'absolute',top:'5px',right:'6px',fontSize: '13px',color:ATTR_COLOR[attr]}}>★</span>}
                  <span style={{position:'absolute',top:'5px',left:'6px',fontSize: '12px',color:ATTR_COLOR[attr],opacity:0.45,fontFamily:"'Cinzel',serif",letterSpacing:'0.06em'}}>SAVE</span>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.14em',color:ATTR_COLOR[attr],marginBottom:'4px',fontWeight:'600',marginTop:'6px'}}>{attr.toUpperCase()}</div>
                  <div style={{fontSize: '35px',fontWeight:'700',color:ATTR_COLOR[attr],lineHeight:'1'}}>{val}</div>
                  <div style={{fontSize: '23px',color:T.gold,fontWeight:'600',marginTop:'5px'}}>{mStr(mod)}</div>
                </button>
              );
            })}
          </div>
          {/* Growth Pool — name left, number right */}
          <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'10px 12px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.14em',color:T.textMuted,fontWeight:'600'}}>GROWTH POOL</span>
              <div style={{background:T.card,border:`1px solid ${T.gold}44`,borderRadius:'3px',fontSize: '29px',fontWeight:'700',color:T.gold,padding:'2px 18px',minWidth:'60px',textAlign:'center'}}>{growthPool}</div>
            </div>
          </div>
        </div>

        {/* ── Resource Points ── */}
        <div style={crd(T.rp)}>
          <SecTitle color={T.rp}>Resource Points</SecTitle>
          {(S.overextended||S.exhausted)&&(
            <div style={{background:'#1a0a06',border:`1px solid ${S.overextended?'#ff202055':'#cc902055'}`,borderRadius:'3px',padding:'6px 10px',marginBottom:'10px',fontSize: '15px',color:S.overextended?'#ff5030':'#cc9020',fontFamily:"'Cinzel',serif",letterSpacing:'0.06em'}}>
              {S.overextended?'⚠ OVEREXTENDED — Base RP ×0.5':'⚠ EXHAUSTED — Base RP ×0.75'}
              {effBaseRP!==baseRP&&<span style={{color:T.textMuted}}> ({baseRP}→{effBaseRP})</span>}
            </div>
          )}
          <div style={{background:T.surface,border:`1px solid #1a304a`,borderRadius:'3px',padding:'12px',textAlign:'center',marginBottom:'10px'}}>
            <label style={{...LBL,textAlign:'center',display:'block',marginBottom:'6px'}}>Current / Maximum</label>
            <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'5px'}}>
              <input type="number" value={curRP} min={0} onChange={e=>setCurRP(Math.max(0,Number(e.target.value)))}
                style={{...inp(),width:'90px',textAlign:'right',fontSize: '31px',fontWeight:'700',color:T.rp,background:'transparent',border:'none',padding:'0'}}/>
              <span style={{color:`${T.rp}55`,fontSize: '25px'}}>/</span>
              <span style={{color:`${T.rp}88`,fontSize: '23px',fontWeight:'500'}}>{effBaseRP}</span>
            </div>
          </div>
          <div style={{height:'5px',background:'#0a1020',borderRadius:'3px',overflow:'hidden',marginBottom:'10px'}}>
            <div style={{height:'100%',width:`${Math.min(100,rpPct)}%`,background:`linear-gradient(90deg,#153358,${T.rp})`,borderRadius:'3px',transition:'width 0.3s'}}/>
          </div>
          {/* Movement */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'12px',background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'7px 12px'}}>
            <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,letterSpacing:'0.1em'}}>MOVEMENT</span>
            <div style={{textAlign:'right'}}>
              <span style={{fontSize: '23px',fontWeight:'600',color:'#88aad8'}}>30<span style={{fontSize: '16px',color:T.textMuted,marginLeft:'3px'}}>ft</span></span>
              <div style={{fontSize: '14px',color:T.textDim}}>+1 ft per RP spent</div>
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'8px',alignItems:'center'}}>
            <div>
              <label style={LBL}>Banked RP</label>
              <div style={{background:T.surface,border:`1px solid ${banking?'#2a6daa55':T.border}`,borderRadius:'3px',padding:'6px 12px',fontSize: '23px',color:banking?'#4a8dcc':T.textDim,fontWeight:'600',textAlign:'center'}}>{bankRP}</div>
            </div>
            <button onClick={handleBank} disabled={bankBlocked || bankNeedsActiveTurn || (!canCommitBank && !banking)}
              style={{...Btn(banking?T.rp:T.textMuted),padding:'8px 14px',marginTop:'18px',background:banking?`${T.rp}15`:'transparent'}}>
              {banking?'● BANKED':'○ BANK'}
            </button>
          </div>
          {bankBlocked&&<div style={{fontSize: '13px',color:'#803020',marginTop:'4px',fontFamily:"'Cinzel',serif"}}>Banking blocked by active state</div>}
          {bankNeedsActiveTurn&&!bankBlocked&&<div style={{fontSize: '13px',color:T.textMuted,marginTop:'4px',fontFamily:"'Cinzel',serif",letterSpacing:'0.06em'}}>Start your turn to bank RP</div>}
        </div>

        {/* ── Hit Points ── */}
        <div style={crd(T.hp)}>
          <SecTitle color={T.hp}>Hit Points</SecTitle>
          <div style={{background:T.surface,border:`1px solid #601010`,borderRadius:'3px',padding:'14px',textAlign:'center',marginBottom:'8px'}}>
            <label style={{...LBL,textAlign:'center',display:'block',marginBottom:'6px'}}>Current / Maximum</label>
            <div style={{display:'flex',alignItems:'baseline',justifyContent:'center',gap:'5px'}}>
              <input type="number" value={curHP} min={0} max={maxHP}
                onChange={e=>setCurHP(Math.max(0,Math.min(maxHP,Number(e.target.value))))}
                style={{...inp(),width:'115px',textAlign:'right',fontSize: '31px',fontWeight:'700',
                  color:curHP<=0?'#c01818':curHP<maxHP*0.25?'#e87030':T.hp,background:'transparent',border:'none',padding:'0'}}/>
              <span style={{color:`${T.hp}55`,fontSize: '25px'}}>/</span>
              <span style={{color:`${T.hp}66`,fontSize: '21px',fontWeight:'500'}}>{fmtNum(maxHP)}</span>
            </div>
          </div>
          <div style={{height:'5px',background:'#1a0808',borderRadius:'3px',overflow:'hidden',marginBottom:'12px'}}>
            <div style={{height:'100%',width:`${hpPct}%`,background:`linear-gradient(90deg,#701010,${T.hp})`,borderRadius:'3px',transition:'width 0.3s'}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <button type="button" onClick={openDmg}  style={{...Btn('#e05050'),padding:'10px',fontSize: '15px',background:'#2a0808'}}>⚔ DAMAGE</button>
            <button type="button" onClick={openHeal} style={{...Btn('#50a050'),padding:'10px',fontSize: '15px',background:'#062006'}}>✦ HEAL</button>
          </div>
          <button
            type="button"
            onClick={() => {
              setDefRpInput(0);
              setDefModal({ attr: 'Agility' });
            }}
            style={{...Btn('#4a7ab8'),padding:'10px',fontSize: '14px',width:'100%',marginTop:'10px',background:'#080c18',letterSpacing:'0.06em'}}
          >
            🛡 DEFENSIVE SAVE
          </button>
          <div style={{fontSize: '13px',color:T.textMuted,marginTop:'6px',lineHeight:1.45,textAlign:'center',fontFamily:"'Cinzel',serif",letterSpacing:'0.04em'}}>
            d20 + Power or Agility mod + defensive bonus (RP spent ÷ Base RP). RP committed is spent.
          </div>
        </div>
      </div>

      {/* ══ ARMOR ════════════════════════════════════════════════════════ */}
      <div style={{...crd('#8a7040'),marginBottom:'14px'}}>
        <SecTitle color="#8a7040">Armor</SecTitle>
        {(S.vulnerable||S.fortified)&&(
          <div style={{background:S.vulnerable?'#1a0800':'#041020',border:`1px solid ${S.vulnerable?'#e0503055':'#50a0e055'}`,borderRadius:'3px',padding:'6px 10px',marginBottom:'10px',fontSize: '15px',color:S.vulnerable?'#e05030':'#50a0e0',fontFamily:"'Cinzel',serif"}}>
            {S.vulnerable&&'⚠ VULNERABLE — Mitigation and resistances halved'}
            {S.fortified&&!S.vulnerable&&'✦ FORTIFIED — Armor mitigation +10%'}
          </div>
        )}
        <table style={{width:'100%',borderCollapse:'collapse',fontSize: '17px'}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${T.border}`}}>
              {['Slot','Name','Type','Rarity','Mitigation','Resistances',''].map((h,i)=>(
                <th key={i} style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.1em',color:T.textMuted,padding:'5px 8px',textAlign:'left',fontWeight:'400',whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ARMOR_SLOTS.map(slot=>{
              const p=armor[slot],has=p.rarity!=='None'||p.name,pRes=ELEMENTS.filter(el=>p.resistances[el]>0);
              const equippedInv = characterId ? findEquippedArmorInventoryForSlot(slot) : null;
              const armorCandidates = characterId ? getArmorInventoryCandidates(slot) : [];
              const canEquipFromInv = armorCandidates.length > 0;
              return(
                <tr key={slot} className="tr-hover" style={{borderBottom:`1px solid ${T.border}`}}>
                  <td style={{padding:'7px 8px',fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,whiteSpace:'nowrap'}}>{slot}</td>
                  <td style={{padding:'7px 8px',fontWeight:'500',color:has?T.text:T.textDim,fontStyle:has?'normal':'italic'}}>{p.name||'Empty'}</td>
                  <td style={{padding:'7px 8px',fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.textMuted}}>{has?p.category:'—'}</td>
                  <td style={{padding:'7px 8px'}}>{has?<Badge rarity={p.rarity}/>:<span style={{color:T.textDim}}>—</span>}</td>
                  <td style={{padding:'7px 8px',fontWeight:'500',color:has?T.text:T.textDim}}>{has?`${p.mitigation}%`:'—'}</td>
                  <td style={{padding:'7px 8px'}}>{pRes.length>0?<div style={{display:'flex',flexWrap:'wrap',gap:'4px'}}>{pRes.map(el=><span key={el} style={{fontSize: '14px',padding:'1px 6px',borderRadius:'8px',background:`${ELEM_COLOR[el]}18`,color:ELEM_COLOR[el],border:`1px solid ${ELEM_COLOR[el]}44`}}>{el.slice(0,3)} {p.resistances[el]}%</span>)}</div>:<span style={{color:T.textDim,fontSize: '15px'}}>—</span>}</td>
                  <td style={{padding:'7px 8px',textAlign:'right'}}>
                    <div style={{display:'inline-flex',flexWrap:'wrap',gap:'6px',justifyContent:'flex-end',alignItems:'center'}}>
                      {characterId && (
                        equippedInv ? (
                          <button type="button" onClick={()=>unequipInventoryItem(equippedInv)} style={{...Btn(T.textMuted),padding:'3px 10px',fontSize: '13px'}}>UNEQUIP</button>
                        ) : (
                          <button type="button" onClick={()=>handleArmorSlotEquipPress(slot)} disabled={!canEquipFromInv} title={!canEquipFromInv ? 'No matching armor in inventory for this slot' : ''} style={{...Btn('#8a7040'),padding:'3px 10px',fontSize: '13px',opacity:canEquipFromInv?1:0.35}}>EQUIP</button>
                        )
                      )}
                      <button type="button" onClick={()=>openArmorEdit(slot)} style={{...Btn(T.goldDim),padding:'3px 10px',fontSize: '13px'}}>✎ EDIT</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{marginTop:'12px',background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'10px 14px',display:'flex',flexWrap:'wrap',gap:'16px',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,letterSpacing:'0.1em'}}>PHYSICAL MIT.</span>
            {S.vulnerable&&totalMit>0?<><span style={{fontSize: '19px',color:T.textDim,textDecoration:'line-through'}}>{totalMit}%</span><span style={{fontSize: '23px',fontWeight:'700',color:'#e05030'}}>{effMit}%</span></>
              :S.fortified&&totalMit>0?<><span style={{fontSize: '19px',color:T.textDim}}>{totalMit}%</span><span style={{fontSize: '23px',fontWeight:'700',color:'#50a0e0'}}>{effMit}%</span></>
              :<span style={{fontSize: '23px',fontWeight:'700',color:effMit>60?'#e08030':T.text}}>{effMit}%</span>}
            {effMit>60&&<span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:'#e08030'}}>⚠ SOFT CAP</span>}
          </div>
          <div style={{width:'1px',height:'20px',background:T.border}}/>
          <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
            {ELEMENTS.filter(el=>totalRes[el]>0).map(el=>{
              const raw=totalRes[el],eff2=effRes[el],abs=eff2>=100;
              return(<div key={el} style={{padding:'2px 9px',borderRadius:'10px',background:`${ELEM_COLOR[el]}15`,border:`1px solid ${ELEM_COLOR[el]}${abs?'88':'33'}`,display:'flex',gap:'4px',alignItems:'center'}}>
                <span style={{fontSize: '15px',color:ELEM_COLOR[el]}}>{el}</span>
                {S.vulnerable&&raw!==eff2?<><span style={{fontSize: '15px',color:T.textDim,textDecoration:'line-through'}}>{raw}%</span><span style={{fontSize: '17px',fontWeight:'600',color:ELEM_COLOR[el]}}>{eff2}%</span></>:<span style={{fontSize: '17px',fontWeight:'600',color:ELEM_COLOR[el]}}>{eff2}%</span>}
                {abs&&<span style={{fontFamily:"'Cinzel',serif",fontSize: '12px',color:ELEM_COLOR[el]}}>ABSORB</span>}
              </div>);
            })}
            {ELEMENTS.every(el=>totalRes[el]===0)&&<span style={{color:T.textDim,fontSize: '16px'}}>No elemental resistances</span>}
          </div>
        </div>
      </div>

      {/* ══ WEAPONS, SPECIAL ABILITIES, ACTIVE STATES & GEMS ═════════════ */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gridTemplateRows:'auto auto',gap:'12px',marginBottom:'14px',alignItems:'stretch'}}>
          <div style={{...crd('#c8503a'),height:'100%',display:'flex',flexDirection:'column'}}>
            <SecTitle color="#c8503a">Weapons</SecTitle>
            {weapons.length===0&&<div style={{color:T.textDim,textAlign:'center',padding:'28px 0',fontSize: '16px',border:`1px dashed #1c2030`,borderRadius:'3px'}}>No weapons equipped</div>}
            {weapons.map(w=>(
              <div key={w.id} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'12px',marginBottom:'8px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'8px'}}>
                  <div>
                    <div style={{fontSize: '20px',fontWeight:'500',marginBottom:'4px'}}>{w.name}</div>
                    <div style={{display:'flex',gap:'6px',alignItems:'center',flexWrap:'wrap'}}>
                      <Badge rarity={w.rarity}/>
                      <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.textMuted}}>{RARITY_DICE[w.rarity]}× {w.dieType}</span>
                      {w.attrReq&&<span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.textMuted}}>REQ: {w.attrReq}</span>}
                    </div>
                  </div>
                  <button onClick={()=>delWeapon(w.id)} style={{...Btn('#662020'),padding:'3px 8px',fontSize: '14px'}}>✕</button>
                </div>
                <div style={{background:'#080a12',border:`1px solid ${T.border}`,borderRadius:'3px',padding:'6px 10px',marginBottom:'8px',fontSize: '17px'}}>
                  {w.channels.map((ch,ci)=>(
                    <span key={ci}>{ci>0&&<span style={{color:T.textDim}}> + </span>}<span style={{color:ch.element==='Physical'?T.text:ELEM_COLOR[ch.element]}}>{ch.dice}{w.dieType}</span><span style={{color:T.textMuted}}> {ch.element}</span></span>
                  ))}<span style={{color:T.textDim}}> × RP</span>
                </div>
                {w.notes&&<div style={{fontSize: '15px',color:T.textMuted,marginBottom:'8px',fontStyle:'italic'}}>{w.notes}</div>}
                <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'6px'}}>
                  <button
                    type="button"
                    onClick={() => openAttack(w, !inActiveTurn)}
                    disabled={S.stunned || S.asleep || (!inActiveTurn && curRP < 1)}
                    style={{
                      ...Btn(inActiveTurn ? '#c8503a' : '#e8a020'),
                      padding: '8px',
                      fontSize: '14px',
                      background: inActiveTurn ? '#1e0806' : '#1a1200',
                      letterSpacing: '0.08em',
                      opacity: (S.stunned || S.asleep || (!inActiveTurn && curRP < 1)) ? 0.35 : 1,
                    }}
                  >
                    {inActiveTurn ? '⚔ ROLL ATTACK' : '⚔ OPPORTUNITY ATTACK'}
                  </button>
                  <button type="button" onClick={()=>openWepEdit(w)} style={{...Btn(T.goldDim),padding:'8px 12px',fontSize: '14px'}}>✎</button>
                </div>
              </div>
            ))}
          </div>

          <div style={{...crd(T.magic),position:'relative',height:'100%',display:'flex',flexDirection:'column'}}>
          {S.silenced&&(
            <div style={{position:'absolute',inset:0,background:'rgba(6,7,12,0.82)',borderRadius:'4px',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',zIndex:5}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize: '17px',letterSpacing:'0.3em',color:'#cc5050',marginBottom:'8px'}}>SILENCED</div>
              <div style={{fontSize: '16px',color:T.textMuted,textAlign:'center',padding:'0 24px'}}>Spell gems unavailable.</div>
            </div>
          )}
          <SecTitle color={T.magic}>Spell Gems</SecTitle>
          {bracerGrade!=='None'&&(
            <div style={{background:'#080810',border:`1px solid #2a2240`,borderRadius:'3px',padding:'7px 12px',marginBottom:'10px',fontSize: '16px',display:'flex',gap:'16px',flexWrap:'wrap',alignItems:'center'}}>
              <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>BRACER:</span> <span style={{color:T.magic}}>{bracerGrade}</span></span>
              <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>SLOTS:</span> {BRACER_SLOTS[bracerGrade]}</span>
              <span style={{color:'#383060',fontSize: '15px'}}>⚡ Auto-hit · No save</span>
            </div>
          )}
          {gems.length===0&&<div style={{color:T.textDim,textAlign:'center',padding:'28px 0',fontSize: '16px',border:`1px dashed #1c2030`,borderRadius:'3px'}}>Equip a Focus Bracer from inventory to unlock gem slots</div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
            {gems.map((gem,gi)=>{
              const isEmpty=!gem||!gem.element;
              const eCol=isEmpty?T.textDim:(ELEM_COLOR[gem.element]||T.text);
              return(
                <div key={gi} style={{background:T.surface,border:`1px solid ${isEmpty?T.border:eCol+'33'}`,borderRadius:'3px',padding:'10px'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'6px'}}>SLOT {gi+1}</div>
                  {isEmpty?(
                    <div style={{color:T.textDim,fontSize: '15px',textAlign:'center',padding:'12px 0',fontStyle:'italic'}}>Empty — equip from inventory</div>
                  ):(
                    <>
                      <div style={{display:'flex',alignItems:'center',gap:'7px',marginBottom:'5px'}}>
                        <div style={{width:'11px',height:'11px',borderRadius:'50%',background:eCol,boxShadow:`0 0 8px ${eCol}66`,flexShrink:0}}/>
                        <span style={{fontSize: '18px',fontWeight:'500',color:eCol}}>{gem.element}</span>
                      </div>
                      <Badge rarity={gem.rarity}/>
                      <div style={{fontSize: '16px',color:T.textMuted,margin:'6px 0'}}>
                        <span style={{color:eCol,fontWeight:'500'}}>{gem.num_dice||1}d{gem.die_type||6}</span> × RP <span style={{color:'#302050'}}>⚡</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => openGemAttack(gem, !inActiveTurn)}
                        disabled={S.stunned || S.asleep || S.silenced || (!inActiveTurn && curRP < 1)}
                        style={{
                          ...Btn(inActiveTurn ? eCol : '#e8a020'),
                          padding: '5px',
                          fontSize: '13px',
                          width: '100%',
                          background: inActiveTurn ? `${eCol}10` : '#1a1200',
                          opacity: (S.stunned || S.asleep || S.silenced || (!inActiveTurn && curRP < 1)) ? 0.35 : 1,
                        }}
                      >
                        {inActiveTurn ? '⚡ CAST' : '⚡ OPPORTUNITY CAST'}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          </div>

          <div style={crd('#5a8a7a')}>
            <SecTitle color="#5a8a7a">Special Abilities</SecTitle>
            {characterId ? (
              <SpecialAbilitiesPanel
                mode="sheet"
                characterId={characterId}
                abilities={specialAbilities}
                onAbilitiesChange={setSpecialAbilities}
                canCreateCustom={canCreateCustomAbilities}
                onUse={(a) => openAbilityUse(a, !inActiveTurn)}
              />
            ) : (
              <div style={{color:T.textDim,textAlign:'center',padding:'20px 0',fontSize: '16px',border:`1px dashed #1c2030`,borderRadius:'3px'}}>
                Link a saved character to add special abilities.
              </div>
            )}
          </div>

          <div style={crd('#706858')}>
            <SecTitle color="#706858" right={
              <select
                value=""
                onChange={e => { addState(e.target.value); e.target.value = ''; }}
                style={{...inp(),width:'160px',fontSize: '14px',padding:'4px 8px',fontFamily:"'Cinzel',serif",letterSpacing:'0.06em'}}
              >
                <option value="">Add State…</option>
                {STATE_CATEGORIES.map(cat => (
                  <optgroup key={cat} label={cat}>
                    {GAME_STATES.filter(s => s.cat === cat).map(s => (
                      <option key={s.name} value={s.name} disabled={active.has(s.name)}>{s.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            }>Active States</SecTitle>
            {active.size === 0 ? (
              <div style={{color:T.textDim,textAlign:'center',padding:'20px 0',fontSize: '16px',border:`1px dashed #1c2030`,borderRadius:'3px'}}>
                No active states
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                {[...active].map(name => {
                  const sd = GAME_STATE_BY_NAME[name];
                  if (!sd) return null;
                  return (
                    <div
                      key={name}
                      onMouseEnter={e => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setStateTip({ name, x: r.left + r.width / 2, y: r.top });
                      }}
                      onMouseLeave={() => setStateTip(prev => (prev?.name === name ? null : prev))}
                      style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'8px',background:T.surface,border:`1px solid ${sd.color}44`,borderRadius:'3px',padding:'6px 10px',cursor:'help'}}
                    >
                      <div style={{display:'flex',alignItems:'center',gap:'8px',minWidth:0}}>
                        <span style={{color:sd.color,fontSize: '16px',fontFamily:"'Cinzel',serif",letterSpacing:'0.06em',whiteSpace:'nowrap'}}>● {name}</span>
                        <span style={{fontFamily:"'Cinzel',serif",fontSize: '12px',color:STATE_CAT_COLOR[sd.cat],letterSpacing:'0.1em',opacity:0.85}}>{sd.cat}</span>
                      </div>
                      <button type="button" onClick={() => removeState(name)} style={{...Btn('#662020'),padding:'2px 8px',fontSize: '13px',flexShrink:0}}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>

      {/* ══ FACTIONS & NOTES ═════════════════════════════════════════════ */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginTop:'12px'}}>
        <div style={crd('#50a060')}>
          <SecTitle color="#50a060" right={<button style={Btn('#50a060')} onClick={addFaction}>+ FACTION</button>}>Factions & Favor</SecTitle>
          <div style={{maxHeight:'420px',overflowY:'auto',paddingRight:'2px'}}>
          {factions.map(f=>{
            const info=getFavor(f.favor),pct=((f.favor+100)/200)*100;
            return(
              <div key={f.id} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'10px',marginBottom:'8px'}}>
                <div style={{display:'flex',gap:'7px',marginBottom:'10px',alignItems:'center'}}>
                  <input value={f.name} onChange={e=>updFaction(f.id,'name',e.target.value)} placeholder="Faction name…" style={{...inp(),flex:1,fontSize: '18px'}}/>
                  <button onClick={()=>delFaction(f.id)} style={{...Btn('#662020'),padding:'4px 9px'}}>✕</button>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'7px'}}>
                  <button onClick={()=>adjFavor(f.id,-1)} style={{...Btn('#4a7040'),padding:'4px 9px',fontSize: '17px',flexShrink:0}}>◀</button>
                  <div style={{flex:1,position:'relative',padding:'8px 0'}}>
                    <div style={{height:'5px',background:'#1a2a22',borderRadius:'3px',position:'relative'}}>
                      <div style={{position:'absolute',left:'50%',top:0,width:'1px',height:'100%',background:'#304838'}}/>
                      <div style={{height:'100%',width:`${pct}%`,background:`linear-gradient(90deg,#c05050,${info.color})`,borderRadius:'3px'}}/>
                    </div>
                    <input type="range" min={-100} max={100} value={f.favor} onChange={e=>updFaction(f.id,'favor',Number(e.target.value))} style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',height:'100%'}}/>
                  </div>
                  <button onClick={()=>adjFavor(f.id,1)} style={{...Btn('#4a7040'),padding:'4px 9px',fontSize: '17px',flexShrink:0}}>▶</button>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',marginTop:'5px'}}>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.textMuted}}>{f.favor>0?'+':''}{f.favor} favor</span>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '15px',color:info.color,fontWeight:'600'}}>{info.label}</span>
                </div>
              </div>
            );
          })}
          {factions.length===0&&<div style={{color:T.textDim,textAlign:'center',padding:'16px 0',fontSize: '16px'}}>No factions tracked</div>}
          </div>
        </div>
        <div style={crd(T.gold)}>
          <SecTitle color={T.gold} right={
            <div style={{display:'flex',gap:'6px'}}>
              <button onClick={()=>{setLibCatFilter('');setLibSearch('');setLibExpanded(null);setLibLoading(true);api.get('/inventory/general-items').then(r=>{setLibGenItems(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));setWepModal('browseGeneral');}} style={{...Btn(T.gold),padding:'4px 10px',fontSize: '13px'}}>+ ITEM</button>
              <button onClick={()=>{setLibSearch('');setLibRarityFilter('');setLibExpanded(null);setLibShowMine(false);setLibLoading(true);api.get('/library/weapons').then(r=>{setLibWeapons(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));setWepModal('browseWeapon');}} style={{...Btn('#c8503a'),padding:'4px 10px',fontSize: '13px'}}>+ WEAPON</button>
              <button onClick={()=>{setLibSlotFilter('');setLibRarityFilter('');setLibSearch('');setLibExpanded(null);setLibShowMine(false);setLibLoading(true);api.get('/library/armor').then(r=>{setLibArmor(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));setWepModal('browseArmor');}} style={{...Btn('#8a7040'),padding:'4px 10px',fontSize: '13px'}}>+ ARMOR</button>
              <button onClick={()=>{setLibElemFilter('');setLibRarityFilter('');setLibExpanded(null);setLibShowMine(false);setLibLoading(true);api.get('/library/spell-gems').then(r=>{setLibGems(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));setWepModal('browseGem');}} style={{...Btn(T.magic),padding:'4px 10px',fontSize: '13px'}}>+ GEM</button>
              <button onClick={()=>{setLibSearch('');setLibExpanded(null);setLibShowMine(false);setLibLoading(true);api.get('/library/focus-bracers').then(r=>{setLibBracers(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));setWepModal('browseBracer');}} style={{...Btn(T.magic),padding:'4px 10px',fontSize: '13px'}}>+ BRACER</button>
            </div>
          }>Inventory</SecTitle>
          <div style={{maxHeight:'420px',overflowY:'auto',paddingRight:'2px'}}>
          {invLoading&&<div style={{textAlign:'center',padding:'20px',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
          {!invLoading&&inventory.length===0&&(
            <div style={{textAlign:'center',padding:'24px',border:`1px dashed ${T.border}`,borderRadius:'3px',color:T.textDim,fontSize: '16px'}}>
              No items in inventory. Use the buttons above to add weapons, armor, gems, or gear.
            </div>
          )}
          {!invLoading&&inventory.length>0&&(()=>{
            const groups = [
              {key:'weapon',       label:'Weapons',       color:'#c8503a'},
              {key:'armor',        label:'Armor',         color:'#8a7040'},
              {key:'focus_bracer', label:'Focus Bracers', color:T.magic},
              {key:'spell_gem',    label:'Spell Gems',    color:T.magic},
              {key:'general',      label:'Gear',          color:T.gold},
            ];
            return groups.map(grp=>{
              const items=inventory.filter(x=>x.item_type===grp.key);
              if(!items.length) return null;
              return(
                <div key={grp.key} style={{marginBottom:'12px'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.18em',color:grp.color,marginBottom:'6px',paddingBottom:'4px',borderBottom:`1px solid ${grp.color}22`}}>{grp.label.toUpperCase()}</div>
                  {items.map(inv=>{
                    const det=inv.item_details;
                    const name=det?.name||'Unknown Item';
                    const isEq=inv.equipped;
                    const firstEmptySlot = gems.findIndex(g => !g || !g.element);
                    const slotPickDefault = grp.key==='spell_gem'
                      ? `bracer_gem_${firstEmptySlot >= 0 ? firstEmptySlot : 0}`
                      : grp.key==='weapon' ? 'main_hand' : '';
                    const slotPick=invEquipSlot[inv.id]||slotPickDefault;
                    return(
                      <div key={inv.id} style={{display:'flex',alignItems:'center',gap:'8px',padding:'7px 10px',marginBottom:'4px',background:isEq?`${grp.color}10`:'transparent',border:`1px solid ${isEq?grp.color+'44':T.border}`,borderRadius:'3px'}}>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize: '16px',fontWeight:'500',color:isEq?grp.color:T.text,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{name}</div>
                          {det&&grp.key==='weapon'&&<div style={{fontSize: '14px',color:T.textMuted}}>{det.rarity} · d{det.base_die_type}</div>}
                          {det&&grp.key==='armor'&&<div style={{fontSize: '14px',color:T.textMuted}}>{cap(det.slot||'')} · {parseFloat(det.mitigation_percent||'0')}% mit</div>}
                          {det&&grp.key==='focus_bracer'&&<div style={{fontSize: '14px',color:T.magic}}>{cap(det.grade||'')} · {det.gem_slots} gem slots{det.req_focus>0?` · FOC ${det.req_focus}+`:''}</div>}
                          {det&&grp.key==='spell_gem'&&<div style={{fontSize: '14px',color:T.textMuted}}>{det.rarity} · {det.num_dice}d{det.die_type} {libGemElement(det.element_type)}</div>}
                          {grp.key==='general'&&<div style={{fontSize: '14px',color:T.textMuted}}>×{inv.quantity}</div>}
                        </div>

                        {/* Equip controls for weapons, armor, gems */}
                        {grp.key==='weapon'&&!isEq&&(
                          <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                            <select value={slotPick} onChange={e=>setInvEquipSlot(p=>({...p,[inv.id]:e.target.value}))} style={{...inp(),width:'100px',fontSize: '14px',padding:'2px 6px'}}>
                              <option value="main_hand">Main Hand</option>
                              <option value="off_hand">Off Hand</option>
                            </select>
                            <button
                              type="button"
                              onClick={()=>equipInventoryItem(inv, slotPick)}
                              disabled={!meetsEquipStatRequirements('weapon', det)}
                              title={equipStatRequirementMessage('weapon', det) || undefined}
                              style={{...Btn('#c8503a'),padding:'3px 10px',fontSize: '13px',opacity:!meetsEquipStatRequirements('weapon', det)?0.35:1}}
                            >
                              EQUIP
                            </button>
                          </div>
                        )}
                        {grp.key==='weapon'&&isEq&&(
                          <button onClick={()=>unequipInventoryItem(inv)} style={{...Btn(T.textMuted),padding:'3px 10px',fontSize: '13px'}}>UNEQUIP</button>
                        )}
                        {grp.key==='armor'&&!isEq&&det&&(
                          <button
                            type="button"
                            onClick={()=>equipInventoryItem(inv, det.slot)}
                            disabled={!meetsEquipStatRequirements('armor', det)}
                            title={equipStatRequirementMessage('armor', det) || undefined}
                            style={{...Btn('#8a7040'),padding:'3px 10px',fontSize: '13px',opacity:!meetsEquipStatRequirements('armor', det)?0.35:1}}
                          >
                            EQUIP
                          </button>
                        )}
                        {grp.key==='armor'&&isEq&&(
                          <button onClick={()=>unequipInventoryItem(inv)} style={{...Btn(T.textMuted),padding:'3px 10px',fontSize: '13px'}}>UNEQUIP</button>
                        )}
                        {grp.key==='focus_bracer'&&!isEq&&(
                          <button
                            type="button"
                            onClick={()=>equipInventoryItem(inv,'bracer')}
                            disabled={!meetsEquipStatRequirements('focus_bracer', det)}
                            title={equipStatRequirementMessage('focus_bracer', det) || undefined}
                            style={{...Btn(T.magic),padding:'3px 10px',fontSize: '13px',opacity:!meetsEquipStatRequirements('focus_bracer', det)?0.35:1}}
                          >
                            EQUIP
                          </button>
                        )}
                        {grp.key==='focus_bracer'&&isEq&&(
                          <button onClick={()=>unequipInventoryItem(inv)} style={{...Btn(T.textMuted),padding:'3px 10px',fontSize: '13px'}}>UNEQUIP</button>
                        )}
                        {grp.key==='spell_gem'&&!isEq&&(
                          <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                            <select value={slotPick} onChange={e=>setInvEquipSlot(p=>({...p,[inv.id]:e.target.value}))} style={{...inp(),width:'90px',fontSize: '14px',padding:'2px 6px'}}>
                              {bracerGrade==='None'
                                ? <option value="">No bracer</option>
                                : Array.from({length:BRACER_SLOTS[bracerGrade]},(_,i)=><option key={i} value={`bracer_gem_${i}`}>Slot {i+1}</option>)
                              }
                            </select>
                            <button onClick={()=>bracerGrade!=='None'&&equipInventoryItem(inv, slotPick)} disabled={bracerGrade==='None'} style={{...Btn(T.magic),padding:'3px 10px',fontSize: '13px',opacity:bracerGrade==='None'?0.4:1}}>EQUIP</button>
                          </div>
                        )}
                        {grp.key==='spell_gem'&&isEq&&(
                          <button onClick={()=>unequipInventoryItem(inv)} style={{...Btn(T.textMuted),padding:'3px 10px',fontSize: '13px'}}>UNEQUIP</button>
                        )}

                        {/* Qty controls for general items */}
                        {grp.key==='general'&&(
                          <div style={{display:'flex',gap:'4px',alignItems:'center'}}>
                            <button onClick={()=>updateInvQty(inv,-1)} style={{...Btn(T.textMuted),padding:'2px 8px',fontSize: '16px'}}>−</button>
                            <button onClick={()=>updateInvQty(inv,+1)} style={{...Btn(T.textMuted),padding:'2px 8px',fontSize: '16px'}}>+</button>
                          </div>
                        )}

                        <button onClick={()=>removeFromInventory(inv)} style={{...Btn('#662020'),padding:'3px 8px',fontSize: '14px',flexShrink:0}}>✕</button>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}
          </div>
        </div>

      </div>

      {/* ══ PETS & NOTES ════════════════════════════════════════════════ */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginTop:'12px'}}>

        {/* Pets / Companions */}
        <div style={crd('#7a5c9e')}>
          <SecTitle color="#9b6fe8" right={
            <button onClick={()=>{
              setLibPetSearch(''); setLibPetLoading(true); setLibPetItems([]);
              api.get('/library/pets').then(r=>{setLibPetItems(r.data.data||r.data||[]);setLibPetLoading(false);}).catch(()=>setLibPetLoading(false));
              setWepModal('browsePet');
            }} style={{...Btn('#9b6fe8'),padding:'4px 10px',fontSize: '13px'}}>+ BOND PET</button>
          }>Pets & Companions</SecTitle>

          <div style={{maxHeight:'420px',overflowY:'auto',paddingRight:'2px'}}>
            {petLoading&&<div style={{textAlign:'center',padding:'20px',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!petLoading&&charPets.length===0&&(
              <div style={{textAlign:'center',padding:'24px',border:`1px dashed ${T.border}`,borderRadius:'3px',color:T.textDim,fontSize: '16px'}}>
                No companions bonded. Press + BOND PET to add one.
              </div>
            )}
            {!petLoading&&charPets.map(bond=>{
              const pet = bond.pet;
              if (!pet) return null;
              const displayName = bond.nickname || pet.name;
              const maxHP = Number(pet.max_hp) || 0;
              const curHP = Number(bond.current_hp) || 0;
              const hpPct = maxHP > 0 ? Math.min(100, (curHP/maxHP)*100) : 0;
              const hpColor = hpPct > 60 ? '#50a060' : hpPct > 25 ? '#c8a020' : '#c05050';
              return(
                <div key={bond.id} style={{background:T.surface,border:`1px solid #9b6fe822`,borderRadius:'3px',padding:'10px',marginBottom:'8px'}}>
                  {/* Header row */}
                  <div style={{display:'flex',alignItems:'center',gap:'7px',marginBottom:'8px'}}>
                    <input
                      value={bond.nickname||''}
                      onChange={e=>updatePetNickname(bond.id, e.target.value||null)}
                      placeholder={pet.name}
                      style={{...inp(),flex:1,fontSize: '17px',fontWeight:'600'}}
                    />
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:'#9b6fe8',background:'#9b6fe811',border:`1px solid #9b6fe833`,borderRadius:'3px',padding:'2px 7px',whiteSpace:'nowrap'}}>{pet.species}</span>
                    <button onClick={()=>removePet(bond.id)} style={{...Btn('#662020'),padding:'4px 9px',flexShrink:0}}>✕</button>
                  </div>

                  {/* HP tracker */}
                  <div style={{marginBottom:'8px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
                      <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>HIT POINTS</span>
                      <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:hpColor,fontWeight:'700'}}>{curHP} / {maxHP}</span>
                    </div>
                    <div style={{height:'5px',background:T.border,borderRadius:'3px',marginBottom:'6px'}}>
                      <div style={{height:'100%',width:`${hpPct}%`,background:hpColor,borderRadius:'3px',transition:'width 0.15s'}}/>
                    </div>
                    <div style={{display:'flex',gap:'6px'}}>
                      <button onClick={()=>updatePetHP(bond.id,-1)} style={{...Btn('#662020'),flex:1,padding:'3px',fontSize: '17px'}}>−</button>
                      <button onClick={()=>updatePetHP(bond.id,+1)} style={{...Btn('#50a060'),flex:1,padding:'3px',fontSize: '17px'}}>+</button>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'4px',marginBottom:'8px'}}>
                    {[['PWR',pet.power,'#c8503a'],['AGI',pet.agility,'#50a060'],['FOC',pet.focus,'#9b6fe8'],['PRE',pet.presence,'#c4922a']].map(([lbl,val,col])=>(
                      <div key={lbl} style={{background:T.bg,borderRadius:'3px',padding:'4px',textAlign:'center',border:`1px solid ${col}22`}}>
                        <div style={{fontFamily:"'Cinzel',serif",fontSize: '12px',color:T.textMuted}}>{lbl}</div>
                        <div style={{fontWeight:'700',color:col,fontSize: '17px'}}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Attacks */}
                  {pet.attacks?.length>0&&(
                    <div>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize: '12px',letterSpacing:'0.14em',color:T.textMuted,marginBottom:'4px'}}>ATTACKS</div>
                      {pet.attacks.map(atk=>(
                        <div key={atk.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'3px 6px',background:T.bg,borderRadius:'3px',marginBottom:'3px',fontSize: '15px'}}>
                          <span style={{color:T.text}}>{atk.name}</span>
                          <span style={{color:'#9b6fe8',fontFamily:"'Cinzel',serif",fontSize: '14px'}}>{atk.damage_dice} <span style={{color:T.textMuted}}>{atk.damage_type}</span></span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Movement & RP */}
                  <div style={{display:'flex',gap:'8px',marginTop:'6px'}}>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>MOV: <span style={{color:T.text}}>{pet.movement}ft</span></span>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>RP: <span style={{color:T.rp}}>{pet.base_rp}</span></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Notes & Misc */}
        <div style={crd(T.gold)}>
          <SecTitle>Notes & Miscellaneous</SecTitle>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Ongoing effects, traits, bonds, scars, story hooks, recovery status…" style={{...inp(),minHeight:'200px',resize:'vertical',lineHeight:'1.7',padding:'10px'}}/>
        </div>
      </div>

      <div style={{textAlign:'center',marginTop:'24px',paddingTop:'14px',borderTop:`1px solid ${T.border}`}}>
        <div style={{fontFamily:"'Cinzel',serif",fontSize: '12px',letterSpacing:'0.25em',color:T.textDim}}>VELION MYTHERA COMPENDIUM — CHARACTER SHEET</div>
      </div>

      {/* ══════════════════════ MODALS ═══════════════════════════════════ */}

      {characterId && progFlow && (
        <LevelProgressionFlow
          open
          mode={progFlow}
          characterId={characterId}
          onClose={() => setProgFlow(null)}
          onApplied={(data) => {
            syncCharacterFromApi(data);
            if (characterId) {
              queryClient.invalidateQueries({ queryKey: characterKeys.detail(characterId) });
            }
          }}
        />
      )}

      {/* Level Up */}
      {luOpen&&(
        <ModalWrap accentColor={T.gold} minW="480px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '16px',letterSpacing:'0.22em',color:T.gold,marginBottom:'2px'}}>LEVEL UP</div>
          <div style={{fontSize: '23px',fontWeight:'500',marginBottom:'4px'}}>Level {level} <span style={{color:T.gold}}>→ {luNewLvl}</span></div>
          <div style={{height:'1px',background:T.goldDim,marginBottom:'18px'}}/>

          <Fld label="Chosen Attribute (used in RP formula)" style={{marginBottom:'16px'}}>
            <select value={luChosen} onChange={e=>setLuChosen(e.target.value)} style={{...inp(),color:ATTR_COLOR[luChosen],fontSize: '19px'}}>
              {ATTRS.map(a=><option key={a} style={{color:ATTR_COLOR[a]}}>{a}</option>)}
            </select>
          </Fld>

          <div style={{marginBottom:'18px'}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:'10px'}}>
              <label style={LBL}>Distribute 2 Attribute Points <span style={{color:T.textDim}}>(max +1 each)</span></label>
              <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:luTotal===2?T.gold:T.textMuted}}>{luTotal}/2</span>
            </div>
            {ATTRS.map(attr=>{
              const cur=attrs[attr],added=luDist[attr],nv=cur+added,canAdd=luDist[attr]<1&&luTotal<2;
              return(
                <div key={attr} style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'8px',background:T.surface,border:`1px solid ${added>0?ATTR_COLOR[attr]+'55':T.border}`,borderRadius:'3px',padding:'8px 12px'}}>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:ATTR_COLOR[attr],minWidth:'75px',fontWeight:'600'}}>{attr}</span>
                  <span style={{fontSize: '21px',color:T.textMuted}}>{cur}</span>
                  {added>0&&<><span style={{color:T.textDim}}>→</span><span style={{fontSize: '21px',fontWeight:'700',color:ATTR_COLOR[attr]}}>{nv}</span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:ATTR_COLOR[attr]}}>(+1)</span></>}
                  <div style={{flex:1}}/>
                  <button onClick={()=>luSub(attr)} disabled={luDist[attr]<=0} style={{...Btn(ATTR_COLOR[attr]),padding:'3px 12px',fontSize: '19px',lineHeight:'1'}}>−</button>
                  <button onClick={()=>luAdd(attr)} disabled={!canAdd}        style={{...Btn(ATTR_COLOR[attr]),padding:'3px 12px',fontSize: '19px',lineHeight:'1',background:canAdd?`${ATTR_COLOR[attr]}15`:'transparent'}}>+</button>
                </div>
              );
            })}
          </div>

          <div style={{marginBottom:'18px',background:T.surface,border:`1px solid ${luGRoll?T.gold+'55':T.border}`,borderRadius:'3px',padding:'12px'}}>
            <label style={LBL}>Growth Pool — Roll 1d6</label>
            <div style={{display:'flex',alignItems:'center',gap:'12px',marginTop:'6px'}}>
              <div style={{flex:1}}>
                <div style={{fontSize: '18px',color:T.textMuted}}>Current: <strong style={{color:T.gold}}>{growthPool}</strong></div>
                {luGRoll != null && (
                  <div style={{fontSize: '18px',marginTop:'3px'}}>
                    Rolled <strong style={{color:T.gold,fontSize: '21px'}}>{luGRoll}</strong> → New: <strong style={{color:T.gold}}>{luNewPool}</strong>
                  </div>
                )}
                {luDiceRolling && (
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'.12em',color:T.gold,marginTop:'6px'}}>
                    Dice are rolling on the table…
                  </div>
                )}
                {luRollErr && (
                  <div style={{fontSize: '16px',color:T.hp,marginTop:'6px'}}>{luRollErr}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void rollLuGrowth()}
                disabled={luDiceRolling}
                style={{...Btn(T.gold),padding:'9px 20px',fontSize: '15px',background:`${T.gold}12`,flexShrink:0,opacity:luDiceRolling?.5:1}}
              >
                {luDiceRolling ? 'ROLLING…' : `⬡ ROLL${luGRoll != null ? ' (reroll)' : ''}`}
              </button>
            </div>
          </div>

          {(luTotal===2||luGRoll)&&(
            <div style={{marginBottom:'18px',background:'#080c0a',border:`1px solid ${T.gold}33`,borderRadius:'3px',padding:'12px'}}>
              <label style={{...LBL,color:T.gold,marginBottom:'8px'}}>Preview at Level {luNewLvl}</label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize: '17px'}}>
                <div style={{background:T.surface,borderRadius:'3px',padding:'7px 10px'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.rp,marginBottom:'3px'}}>BASE RP</div>
                  <span style={{color:T.textMuted}}>{baseRP}</span> → <span style={{color:T.rp,fontWeight:'700',fontSize: '21px'}}>{luNewBase}</span>
                </div>
                <div style={{background:T.surface,borderRadius:'3px',padding:'7px 10px'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.hp,marginBottom:'3px'}}>MAX HP</div>
                  <span style={{color:T.textMuted}}>{fmtNum(maxHP)}</span> → <span style={{color:T.hp,fontWeight:'700',fontSize: '21px'}}>{fmtNum(luNewHP)}</span>
                </div>
              </div>
            </div>
          )}

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <button onClick={()=>setLuOpen(false)} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
            <button onClick={confirmLU} disabled={!luReady} style={{...Btn(T.gold),padding:'10px',background:luReady?`${T.gold}15`:'transparent',fontSize: '15px',letterSpacing:'0.12em'}}>✦ CONFIRM LEVEL UP</button>
          </div>
        </ModalWrap>
      )}

      {/* Armor equip — pick inventory row when multiple match slot */}
      {armorEquipPicker && (
        <ModalWrap accentColor="#8a7040" minW="440px">
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: '15px', letterSpacing: '0.22em', color: '#8a7040', marginBottom: '2px' }}>EQUIP ARMOR</div>
          <div style={{ fontSize: '20px', fontWeight: '500', marginBottom: '4px' }}>{armorEquipPicker.slot}</div>
          <div style={{ height: '1px', background: '#3a2f10', marginBottom: '14px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px', maxHeight: 'min(60vh, 360px)', overflowY: 'auto' }}>
            {armorEquipPicker.items.map((inv) => {
              const det = inv.item_details;
              const nm = det?.name || 'Armor';
              return (
                <div
                  key={inv.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 12px',
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '17px', fontWeight: '500', marginBottom: '4px' }}>{nm}</div>
                    <div style={{ fontSize: '14px', color: T.textMuted }}>
                      {det ? <><Badge rarity={cap(det.rarity || 'None')} /> · {parseFloat(det.mitigation_percent || '0')}% mit · {cap(det.category || '')}</> : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!det?.slot) return;
                      equipInventoryItem(inv, det.slot);
                      setArmorEquipPicker(null);
                    }}
                    style={{ ...Btn('#8a7040'), padding: '8px 14px', fontSize: '14px', flexShrink: 0 }}
                  >
                    EQUIP
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => setArmorEquipPicker(null)} style={{ ...Btn(T.textMuted), padding: '10px', width: '100%' }}>
            CANCEL
          </button>
        </ModalWrap>
      )}

      {/* Armor Edit */}
      {armorModal&&armorDraft&&(
        <ModalWrap accentColor="#8a7040" minW="480px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:'#8a7040',marginBottom:'2px'}}>EDIT ARMOR SLOT</div>
          <div style={{fontSize: '22px',fontWeight:'500',marginBottom:'4px'}}>{armorModal}</div>
          <div style={{height:'1px',background:'#3a2f10',marginBottom:'16px'}}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'12px'}}>
            <Fld label="Name"><input value={armorDraft.name} onChange={e=>setArmorDraft(p=>({...p,name:e.target.value}))} placeholder={`${armorModal} name…`} style={inp()}/></Fld>
            <Fld label="Category"><select value={armorDraft.category} onChange={e=>setArmorDraft(p=>({...p,category:e.target.value}))} style={inp()}>{['Light','Medium','Heavy'].map(c=><option key={c}>{c}</option>)}</select></Fld>
            <Fld label="Rarity"><select value={armorDraft.rarity} onChange={e=>setArmorDraft(p=>({...p,rarity:e.target.value}))} style={{...inp(),color:RARITY_COLOR[armorDraft.rarity]}}>{RARITIES.map(r=><option key={r} style={{color:RARITY_COLOR[r]}}>{r}</option>)}</select></Fld>
            <Fld label="Physical Mitigation %"><div style={{display:'flex',alignItems:'center',gap:'6px'}}><input type="number" value={armorDraft.mitigation} min={0} max={100} onChange={e=>setArmorDraft(p=>({...p,mitigation:Number(e.target.value)}))} style={inp()}/><span style={{color:T.textMuted,flexShrink:0}}>%</span></div></Fld>
          </div>
          <div style={{marginBottom:'16px'}}>
            <label style={{...LBL,marginBottom:'8px'}}>Elemental Resistances %</label>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'6px'}}>
              {ELEMENTS.map(el=>(
                <div key={el}>
                  <label style={{...LBL,color:ELEM_COLOR[el],fontSize: '12px',marginBottom:'2px'}}>{el}</label>
                  <input type="number" value={armorDraft.resistances[el]} min={0} max={200} onChange={e=>updDraftRes(el,e.target.value)} style={{...inp(),textAlign:'center',fontSize: '16px',padding:'3px 5px'}}/>
                </div>
              ))}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <button onClick={()=>{setArmorModal(null);setArmorDraft(null);}} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
            <button onClick={applyArmor} style={{...Btn('#8a7040'),padding:'10px',background:'#181005',fontSize: '15px'}}>✓ APPLY CHANGES</button>
          </div>
        </ModalWrap>
      )}

      {/* Weapon Edit */}
      {wepModal==='edit'&&wepDraft&&(
        <ModalWrap accentColor="#c8503a" minW="480px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:'#c8503a',marginBottom:'16px'}}>WEAPON CONFIGURATION</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px',marginBottom:'12px'}}>
            <Fld label="Weapon Name"><input value={wepDraft.name} onChange={e=>setWepDraft(p=>({...p,name:e.target.value}))} style={inp()}/></Fld>
            <Fld label="Attribute Req."><input value={wepDraft.attrReq} onChange={e=>setWepDraft(p=>({...p,attrReq:e.target.value}))} placeholder="e.g. PWR 14" style={inp()}/></Fld>
            <Fld label="Rarity"><select value={wepDraft.rarity} onChange={e=>setWepDraft(p=>({...p,rarity:e.target.value}))} style={{...inp(),color:RARITY_COLOR[wepDraft.rarity]}}>{RARITIES.filter(r=>r!=='None').map(r=><option key={r} style={{color:RARITY_COLOR[r]}}>{r}</option>)}</select></Fld>
            <Fld label="Base Die Type"><select value={wepDraft.dieType} onChange={e=>setWepDraft(p=>({...p,dieType:e.target.value}))} style={inp()}>{DIE_TYPES.map(d=><option key={d}>{d}</option>)}</select></Fld>
          </div>
          <div style={{marginBottom:'12px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
              <label style={LBL}>Damage Channels</label>
              <button onClick={draftAddCh} style={{...Btn('#c8503a'),padding:'3px 10px',fontSize: '13px'}}>+ CHANNEL</button>
            </div>
            {wepDraft.channels.map((ch,ci)=>(
              <div key={ci} style={{display:'flex',gap:'7px',alignItems:'center',marginBottom:'5px',background:'#080a12',padding:'6px 8px',borderRadius:'3px'}}>
                <select value={ch.element} onChange={e=>draftUpdCh(ci,'element',e.target.value)} style={{...inp(),flex:1,color:ch.element==='Physical'?T.text:ELEM_COLOR[ch.element]}}>
                  <option value="Physical">Physical</option>
                  {ELEMENTS.map(el=><option key={el} style={{color:ELEM_COLOR[el]}}>{el}</option>)}
                </select>
                <input type="number" value={ch.dice} min={1} max={12} onChange={e=>draftUpdCh(ci,'dice',Number(e.target.value))} style={{...inp(),width:'55px',textAlign:'center'}}/>
                <span style={{color:T.textMuted,fontSize: '17px',whiteSpace:'nowrap'}}>{wepDraft.dieType} × RP</span>
                {wepDraft.channels.length>1&&<button onClick={()=>draftDelCh(ci)} style={{...Btn('#662020'),padding:'3px 7px'}}>✕</button>}
              </div>
            ))}
          </div>
          <Fld label="Notes / Special Properties" style={{marginBottom:'16px'}}><input value={wepDraft.notes} onChange={e=>setWepDraft(p=>({...p,notes:e.target.value}))} placeholder="Enchantments, special rules…" style={inp()}/></Fld>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <button onClick={()=>{setWepModal(null);setWepDraft(null);}} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
            <button onClick={applyWepEdit} style={{...Btn('#c8503a'),padding:'10px',background:'#1a0604',fontSize: '15px'}}>✓ APPLY WEAPON</button>
          </div>
        </ModalWrap>
      )}

      {/* Attack Modal */}
      {wepModal==='attack'&&atkWeapon&&(
        <ModalWrap accentColor="#c8503a" minW="480px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:atkOppFlow?'#a87850':'#c8503a',marginBottom:'2px'}}>
            {atkOppFlow
              ? (atkStage === 'stake' ? 'OPPORTUNITY ATTACK' : 'RESOLVE OPPORTUNITY')
              : atkStage==='stake'?'STAKE RESOURCE POINTS':atkStage==='roll'?'RESOLVE ATTACK':'ATTACK RESULT'}
          </div>
          <div style={{fontSize: '22px',fontWeight:'500',marginBottom:'4px'}}>{atkWeapon.name}</div>
          <div style={{display:'flex',gap:'7px',alignItems:'center',marginBottom:'16px'}}>
            <Badge rarity={atkWeapon.rarity}/>
            <span style={{fontSize: '16px',color:T.textMuted}}>
              {atkWeapon.channels.map((ch,ci)=>(
                <span key={ci}>{ci>0?' + ':''}{ch.dice}{atkWeapon.dieType} <span style={{color:ch.element==='Physical'?T.textMuted:ELEM_COLOR[ch.element]}}>{ch.element}</span></span>
              ))}{atkOppFlow ? ' × 1 (no RP multiplier)' : ' × RP'}
            </span>
          </div>

          {/* Stage 1: Stake — opportunity (1 RP, no overextend) */}
          {atkStage==='stake'&&!oxOpen&&atkOppFlow&&(
            <div style={{marginBottom:'16px'}}>
              <div style={{fontSize: '16px',color:T.textMuted,lineHeight:1.65,marginBottom:'14px',background:'#0c0a08',border:`1px solid ${T.border}`,borderRadius:'3px',padding:'12px'}}>
                Costs <strong style={{color:T.rp}}>1 RP</strong> from your pool. Damage uses weapon dice <strong>×1</strong> (not × staked RP). Pressure steps / offensive overextend do not apply.
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                <button type="button" onClick={cancelPreStake} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
                <button type="button" onClick={doStake} disabled={curRP < 1} style={{...Btn('#c8503a'),padding:'10px',background:'#1a0604',fontSize: '15px',opacity:curRP<1?0.35:1}}>SPEND 1 RP — CONTINUE</button>
              </div>
            </div>
          )}

          {/* Stage 1: Stake — normal turn */}
          {atkStage==='stake'&&!oxOpen&&!atkOppFlow&&(
            <>
              <div style={{marginBottom:'14px'}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                  <label style={LBL}>RP to Stake</label>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.rp}}>
                    Available: <strong>{curRP}</strong>
                    {tempRP>0&&<span style={{color:'#ff7040'}}> +{tempRP} OX temp</span>}
                  </span>
                </div>
                <div style={{display:'flex',gap:'12px',alignItems:'center',marginBottom:'8px'}}>
                  <div style={{display:'flex',alignItems:'stretch',flexShrink:0}}>
                    <button onClick={()=>setAtkRP(p=>Math.max(0,p-1))} style={{...Btn('#c8503a'),padding:'0 12px',fontSize: '25px',fontWeight:'300',borderRight:'none',borderRadius:'3px 0 0 3px',lineHeight:1}}>−</button>
                    <StableNumInput
                      value={atkRP}
                      onChange={v=>setAtkRP(Math.min(curRP+tempRP,Math.max(0,v)))}
                      min={0} max={curRP+tempRP}
                      style={{...inp(),width:'72px',textAlign:'center',fontSize: '25px',fontWeight:'700',color:'#c8503a',borderRadius:0,borderLeft:'none',borderRight:'none'}}
                    />
                    <button onClick={()=>setAtkRP(p=>Math.min(curRP+tempRP,p+1))} style={{...Btn('#c8503a'),padding:'0 12px',fontSize: '25px',fontWeight:'300',borderLeft:'none',borderRadius:'0 3px 3px 0',lineHeight:1}}>+</button>
                  </div>
                  {/* Controlled slider — updates atkRP (and StableNumInput) while dragging */}
                  <div style={{flex:1,position:'relative',padding:'10px 0'}}>
                    <div style={{height:'6px',background:'#1c2030',borderRadius:'3px',position:'relative',overflow:'visible'}}>
                      <div style={{height:'100%',width:`${(curRP+tempRP)>0?Math.min(100,(atkRP/(curRP+tempRP))*100):0}%`,background:'#c8503a',borderRadius:'3px'}}/>
                      <div style={{position:'absolute',top:'50%',transform:'translateY(-50%)',left:`calc(${(curRP+tempRP)>0?Math.min(100,(atkRP/(curRP+tempRP))*100):0}% - 8px)`,width:'16px',height:'16px',borderRadius:'50%',background:'#c8503a',boxShadow:'0 0 7px #c8503a99',pointerEvents:'none'}}/>
                    </div>
                    <input
                      key={`atk-rp-max-${curRP}-${tempRP}`}
                      type="range"
                      min={0}
                      max={curRP+tempRP||1}
                      value={atkRP}
                      onChange={e=>{
                        const mx = curRP + tempRP || 1;
                        const v = Math.max(0, Math.min(mx, Number(e.target.value) || 0));
                        setAtkRP(v);
                      }}
                      style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',width:'100%',height:'100%',margin:0,padding:0}}
                    />
                  </div>
                </div>
                <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'10px',marginBottom:'10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>PRESSURE STEPS</span>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:'#c8503a'}}>{pSteps(atkRP,curRP)}/5 · Save DC: <strong>{10+pSteps(atkRP,curRP)*2}</strong></span>
                  </div>
                  <div style={{display:'flex',gap:'4px'}}>
                    {[1,2,3,4,5].map(i=><div key={i} style={{flex:1,height:'7px',borderRadius:'2px',background:i<=pSteps(atkRP,curRP)?'#c8503a':'#1c2030',transition:'background 0.12s'}}/>)}
                  </div>
                </div>
                {tempRP > 0 ? (
                  <div style={{background:'#1a0800',border:`1px solid #ff402055`,borderRadius:'3px',padding:'8px 12px',fontSize: '16px',color:'#ff7040'}}>⚠ Overextend: +{tempRP} temp RP · State applied after attack</div>
                ) : oxRolledThisAttack ? (
                  <div style={{background:'#1a1008',border:`1px solid #88404055`,borderRadius:'3px',padding:'8px 12px',fontSize: '15px',color:'#c08080',lineHeight:1.45}}>
                    ⚠ Overextend already used this attack (failed save — no temp RP). You can declare overextension again on a later attack.
                  </div>
                ) : (
                  <button type="button" onClick={()=>setOxOpen(true)} style={{...Btn('#ff4020'),padding:'7px',width:'100%',fontSize: '14px',background:'#1a0800',letterSpacing:'0.08em'}}>⚠ OVEREXTEND</button>
                )}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                <button onClick={cancelPreStake} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
                <button onClick={doStake} disabled={atkRP===0} style={{...Btn('#c8503a'),padding:'10px',background:'#1a0604',fontSize: '15px',opacity:atkRP===0?0.3:1}}>⚔ STAKE {atkRP} RP</button>
              </div>
            </>
          )}

          {/* Overextend sub-panel (not used on opportunity attacks) */}
          {atkStage==='stake'&&oxOpen&&!atkOppFlow&&(
            <div style={{background:'#100806',border:`1px solid #ff402055`,borderRadius:'4px',padding:'16px'}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.18em',color:'#ff5030',marginBottom:'12px'}}>⚠ OVEREXTEND</div>
              <div style={{fontSize: '16px',color:T.textMuted,lineHeight:'1.7',marginBottom:'14px'}}>
                Declare extra RP beyond your pool (max = your available RP). Save DC = 10 + (10 × OE ÷ A), clamped 10–20 (OE = borrow, A = available). Roll d20 — meet or beat DC to gain temp RP for this attack.<br/>
                <span style={{color:'#ff7040'}}>If you succeed, you gain temp RP for this attack and become Overextended when the attack finishes. If you fail, you gain no temp RP and do not become Overextended.</span>
              </div>
              <Fld label={`Extra RP to borrow (max ${curRP})`} style={{marginBottom:'8px'}}>
                <StableNumInput
                  value={oxAmount}
                  onChange={setOxAmount}
                  min={0}
                  max={curRP}
                  style={{...inp(),textAlign:'center',fontSize: '25px',color:'#ff5030'}}
                />
              </Fld>
              {!oxRoll && (
                <div style={{fontSize: '15px',color:T.textMuted,marginBottom:'12px',fontFamily:"'Cinzel',serif",letterSpacing:'0.06em'}}>
                  OE <strong style={{color:'#ff7040'}}>{Math.min(oxAmount, curRP)}</strong>
                  {' · '}
                  DC <strong style={{color:'#ff7040'}}>{calcOverextensionDC(Math.min(oxAmount, curRP), curRP)}</strong>
                </div>
              )}
              {!oxRoll&&<button onClick={rollOX} disabled={oxAmount===0||curRP===0} style={{...Btn('#ff4020'),padding:'9px',width:'100%',fontSize: '15px',background:'#1a0800',marginBottom:'10px',opacity:oxAmount===0||curRP===0?0.3:1}}>⬡ ROLL d20</button>}
              {oxRoll&&(
                <div style={{background:oxResult==='success'?'#0a2010':'#1e0808',border:`1px solid ${oxResult==='success'?'#50a04055':'#cc404055'}`,borderRadius:'3px',padding:'12px',marginBottom:'12px',textAlign:'center'}}>
                  <div style={{fontSize: '37px',fontWeight:'700',color:oxResult==='success'?'#60d040':'#e05050',marginBottom:'4px'}}>{oxRoll}</div>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.14em',color:oxResult==='success'?'#60d040':'#e05050',marginBottom:'4px'}}>
                    {oxResult === 'success'
                      ? `SUCCESS — +${oxAmount} temp RP granted`
                      : 'FAIL — No extra RP. You do not overextend.'}
                  </div>
                  <div style={{fontSize: '15px',color:T.textMuted}}>
                    DC {calcOverextensionDC(Math.min(oxAmount, curRP), curRP)} · Rolled {oxRoll}
                  </div>
                </div>
              )}
              <div style={{display:'grid',gridTemplateColumns: oxRoll ? '1fr' : '1fr 1fr',gap:'8px'}}>
                {!oxRoll && (
                  <button
                    type="button"
                    onClick={()=>{setOxOpen(false);setOxAmount(0);setOxRoll(null);setOxResult(null);setTempRP(0);}}
                    style={{...Btn(T.textMuted),padding:'9px',fontSize: '14px'}}
                  >
                    CANCEL
                  </button>
                )}
                <button type="button" onClick={confirmOX} disabled={!oxRoll} style={{...Btn('#ff4020'),padding:'9px',fontSize: '14px',background:'#1a0800',opacity:oxRoll?1:0.3}}>CONFIRM</button>
              </div>
            </div>
          )}

          {/* Stage 2: Resolve — crit roll, damage roll, result all inline */}
          {atkStage==='roll'&&(
            <>
              {/* RP staked summary */}
              <div style={{background:'#0e0a06',border:`1px solid #c8503a44`,borderRadius:'3px',padding:'12px',marginBottom:'14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'3px'}}>{atkOppFlow ? 'RP COST' : 'RP STAKED'}</div>
                  <div style={{fontSize: '29px',fontWeight:'700',color:'#c8503a'}}>{atkStaked} RP</div>
                  <div style={{fontSize: '15px',color:T.textDim,marginTop:'2px'}}>
                    {atkOppFlow ? 'Opportunity attack · damage uses ×1' : 'Deducted · cannot be recovered'}
                  </div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'3px'}}>FORMULA</div>
                  <div style={{fontSize: '18px',color:T.text}}>
                    {atkOppFlow
                      ? atkWeapon.channels.map((ch,ci)=>`${ci>0?' + ':''}${ch.dice}${atkWeapon.dieType} × 1`).join('')
                      : atkWeapon.channels.map((ch,ci)=>`${ci>0?' + ':''}${ch.dice}${atkWeapon.dieType} × ${atkStaked}`).join('')}
                  </div>
                </div>
              </div>

              {/* Step 1: Crit roll */}
              <div style={{marginBottom:'12px'}}>
                <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.14em',color:T.textMuted,marginBottom:'8px'}}>STEP 1 — CRITICAL HIT ROLL</div>
                {atkCritRoll===null
                  ? <button onClick={doCritRoll} style={{...Btn('#e8a020'),padding:'11px',width:'100%',background:'#1a1000',fontSize: '15px',letterSpacing:'0.1em'}}>⬡ ROLL FOR CRIT (d20)</button>
                  : <div style={{background:atkIsCrit?'#1a1200':'#0c0c10',border:`1px solid ${atkIsCrit?'#e8a02066':'#2a2a40'}`,borderRadius:'3px',padding:'12px',display:'flex',alignItems:'center',gap:'16px'}}>
                      <div style={{fontSize: '41px',fontWeight:'700',color:atkIsCrit?'#e8a020':T.text,lineHeight:1}}>{atkCritRoll}</div>
                      <div>
                        {atkIsCrit
                          ? <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.14em',color:'#e8a020'}}>⭑ CRITICAL HIT</div>
                          : <div style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.textMuted}}>No crit <span style={{color:T.textDim}}>(need 20)</span></div>
                        }
                        <div style={{fontSize: '15px',color:T.textDim,marginTop:'2px'}}>Rolled {atkCritRoll} on d20</div>
                      </div>
                    </div>
                }
              </div>

              {/* Step 2: Damage roll */}
              <div style={{marginBottom:'12px',opacity:atkCritRoll===null?0.35:1,transition:'opacity 0.2s'}}>
                <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.14em',color:T.textMuted,marginBottom:'8px'}}>STEP 2 — DAMAGE ROLL</div>
                {!atkResult
                  ? <button onClick={doDmgRoll} disabled={atkCritRoll===null} style={{...Btn('#c8503a'),padding:'11px',width:'100%',background:'#1a0604',fontSize: '15px',letterSpacing:'0.1em'}}>
                      ⚔ ROLL DAMAGE {atkIsCrit&&<span style={{color:'#e8a020'}}> · ×2 CRIT</span>}
                    </button>
                  : <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                      {atkResult.chs.map((ch,ci)=>{
                        const elColor = ch.element==='Physical' ? T.text : ELEM_COLOR[ch.element];
                        const dmg = atkResult.isCrit ? ch.dmg*2 : ch.dmg;
                        return(
                          <div key={ci} style={{background:atkResult.isCrit?'#1a1200':'#0c0c10',border:`1px solid ${atkResult.isCrit?'#e8a02044':elColor+'33'}`,borderRadius:'3px',padding:'12px',display:'flex',alignItems:'center',gap:'16px'}}>
                            <div style={{fontSize: '41px',fontWeight:'700',color:atkResult.isCrit?'#e8a020':elColor,lineHeight:1}}>{ch.sum}</div>
                            <div style={{flex:1}}>
                              <div style={{fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.1em',color:elColor,marginBottom:'3px'}}>{ch.element.toUpperCase()}</div>
                              <div style={{fontSize: '15px',color:T.textDim}}>
                                {ch.rolls.length>1?`(${ch.rolls.join('+')}=${ch.sum})`:ch.rolls[0]}
                                {atkOppFlow ? ' × 1 (opportunity)' : ` × ${atkResult.rpUsed} RP`}
                                {atkResult.isCrit?' × 2 CRIT':''}
                              </div>
                            </div>
                            <div style={{textAlign:'right'}}>
                              <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'2px'}}>DMG</div>
                              <div style={{fontWeight:'700',fontSize: '25px',color:atkResult.isCrit?'#e8a020':elColor}}>{fmtNum(dmg)}</div>
                            </div>
                          </div>
                        );
                      })}
                      <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>
                          {atkResult.isCrit
                            ? <span style={{color:'#e8a020'}}>⭑ CRITICAL HIT — doubled</span>
                            : <span>CRIT ROLL: <strong style={{color:T.text}}>{atkResult.critRoll}</strong> <span style={{color:T.textDim}}>(need 20)</span></span>
                          }
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'2px'}}>TOTAL DAMAGE</div>
                          <div style={{color:atkResult.isCrit?'#e8a020':'#c8503a',fontWeight:'700',fontSize: '31px'}}>{fmtNum(atkResult.chs.reduce((s,c)=>s+(atkResult.isCrit?c.dmg*2:c.dmg),0))}</div>
                        </div>
                      </div>
                      {!atkOppFlow && tempRP > 0 && (
                        <div style={{padding:'6px 10px',background:'#1a0800',border:`1px solid #ff402055`,borderRadius:'3px',fontSize: '14px',color:'#ff7040',fontFamily:"'Cinzel',serif",letterSpacing:'0.06em'}}>⚠ OVEREXTENDED state applied</div>
                      )}
                    </div>
                }
              </div>

              {/* Close / cancel */}
              {atkResult
                ? <button onClick={closeAtk} style={{...Btn('#c8503a'),padding:'10px',width:'100%',background:'#1a0604',fontSize: '15px',letterSpacing:'0.1em'}}>CLOSE</button>
                : <button onClick={cancelPostStake} style={{...Btn(T.textMuted),padding:'8px',width:'100%',fontSize: '14px'}}>TARGET SAVED — CLOSE (RP spent)</button>
              }
            </>
          )}

          {/* Stage 3: result stage no longer used — kept as safety fallback */}
          {atkStage==='result'&&atkResult&&(
            <button onClick={closeAtk} style={{...Btn('#c8503a'),padding:'12px',width:'100%',background:'#1a0604',fontSize: '15px'}}>CLOSE</button>
          )}
        </ModalWrap>
      )}

      {/* Gem Attack Modal */}
      {wepModal==='gemAttack'&&gemAtkGem&&(()=>{
        const eCol=ELEM_COLOR[gemAtkGem.element]||T.magic;
        const nd=Number(gemAtkGem.num_dice)||1;
        const dt=Number(gemAtkGem.die_type)||6;
        return(
          <ModalWrap accentColor={eCol} minW="440px">
            <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:eCol,marginBottom:'2px'}}>
              {gemOppFlow
                ? (gemAtkStage === 'stake' ? 'OPPORTUNITY CAST' : 'RESOLVE OPPORTUNITY CAST')
                : gemAtkStage==='stake'?'STAKE RESOURCE POINTS':'RESOLVE SPELL ATTACK'}
            </div>
            <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'16px'}}>
              <div style={{width:'14px',height:'14px',borderRadius:'50%',background:eCol,boxShadow:`0 0 10px ${eCol}88`,flexShrink:0}}/>
              <div>
                <div style={{fontSize: '22px',fontWeight:'500',color:eCol}}>{gemAtkGem.element}</div>
                <div style={{fontSize: '15px',color:T.textMuted}}>
                  {nd}d{dt}{gemOppFlow ? ' × 1 (no RP multiplier)' : ' × RP'} · <span style={{color:eCol}}>Auto-hit · No save</span>
                </div>
              </div>
              <Badge rarity={gemAtkGem.rarity}/>
            </div>

            {gemAtkStage==='stake'&&gemOppFlow&&(
              <div style={{marginBottom:'16px'}}>
                <div style={{fontSize: '16px',color:T.textMuted,lineHeight:1.65,marginBottom:'14px',background:'#080810',border:`1px solid ${T.border}`,borderRadius:'3px',padding:'12px'}}>
                  Costs <strong style={{color:T.rp}}>1 RP</strong>. Spell damage uses <strong>×1</strong> (not × staked RP). Normal turn staking does not apply.
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                  <button type="button" onClick={closeGemAtk} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
                  <button type="button" onClick={doGemStake} disabled={curRP < 1} style={{...Btn(eCol),padding:'10px',background:`${eCol}10`,fontSize: '15px',opacity:curRP<1?0.35:1}}>SPEND 1 RP — CONTINUE</button>
                </div>
              </div>
            )}

            {gemAtkStage==='stake'&&!gemOppFlow&&(
              <>
                <div style={{marginBottom:'14px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                    <label style={LBL}>RP to Stake</label>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.rp}}>Available: <strong>{curRP}</strong></span>
                  </div>
                  <div style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'8px'}}>
                    <div style={{display:'flex',alignItems:'stretch',flexShrink:0}}>
                      <button onClick={()=>setGemAtkRP(p=>Math.max(0,p-1))} style={{...Btn(eCol),padding:'0 12px',fontSize: '25px',fontWeight:'300',borderRight:'none',borderRadius:'3px 0 0 3px',lineHeight:1}}>−</button>
                      <StableNumInput value={gemAtkRP} onChange={v=>setGemAtkRP(Math.min(curRP,Math.max(0,v)))} min={0} max={curRP}
                        style={{...inp(),width:'72px',textAlign:'center',fontSize: '25px',fontWeight:'700',color:eCol,borderRadius:0,borderLeft:'none',borderRight:'none'}}/>
                      <button onClick={()=>setGemAtkRP(p=>Math.min(curRP,p+1))} style={{...Btn(eCol),padding:'0 12px',fontSize: '25px',fontWeight:'300',borderLeft:'none',borderRadius:'0 3px 3px 0',lineHeight:1}}>+</button>
                    </div>
                    <div style={{flex:1,position:'relative',padding:'10px 0'}}>
                      <div style={{height:'6px',background:'#1c2030',borderRadius:'3px',position:'relative',overflow:'visible'}}>
                        <div ref={gemFillRef} style={{height:'100%',width:`${curRP>0?Math.min(100,(gemAtkRP/curRP)*100):0}%`,background:eCol,borderRadius:'3px'}}/>
                        <div ref={gemThumbRef} style={{position:'absolute',top:'50%',transform:'translateY(-50%)',left:`calc(${curRP>0?Math.min(100,(gemAtkRP/curRP)*100):0}% - 8px)`,width:'16px',height:'16px',borderRadius:'50%',background:eCol,boxShadow:`0 0 7px ${eCol}99`,pointerEvents:'none'}}/>
                      </div>
                      <input
                        key={`gem-${gemAtkRP}-${curRP}`}
                        type="range" min={0} max={curRP||1}
                        defaultValue={gemAtkRP}
                        onInput={e=>{
                          const v=Number(e.target.value), mx=curRP||1;
                          const pct=Math.min(100,(v/mx)*100);
                          gemDragValRef.current=v;
                          if(gemFillRef.current)  gemFillRef.current.style.width=`${pct}%`;
                          if(gemThumbRef.current) gemThumbRef.current.style.left=`calc(${pct}% - 8px)`;
                        }}
                        onMouseUp={()=>setGemAtkRP(gemDragValRef.current)}
                        onTouchEnd={()=>setGemAtkRP(gemDragValRef.current)}
                        style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',width:'100%',height:'100%',margin:0,padding:0}}/>
                    </div>
                  </div>
                  <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'8px 12px',fontSize: '16px',color:T.textMuted}}>
                    <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>FORMULA </span>
                    <span style={{color:eCol}}>{nd}d{dt}</span> × <span style={{color:T.rp,fontWeight:'700'}}>{gemAtkRP}</span>
                    {gemAtkRP>0&&<span style={{color:T.textDim}}> = up to {nd*dt*gemAtkRP} dmg</span>}
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
                  <button onClick={closeGemAtk} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
                  <button onClick={doGemStake} disabled={gemAtkRP===0} style={{...Btn(eCol),padding:'10px',background:`${eCol}10`,fontSize: '15px',opacity:gemAtkRP===0?0.3:1}}>⚡ STAKE {gemAtkRP} RP</button>
                </div>
              </>
            )}

            {gemAtkStage==='roll'&&(
              <>
                {/* RP staked summary */}
                <div style={{background:`${eCol}08`,border:`1px solid ${eCol}33`,borderRadius:'3px',padding:'12px',marginBottom:'14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'3px'}}>{gemOppFlow ? 'RP COST' : 'RP STAKED'}</div>
                    <div style={{fontSize: '29px',fontWeight:'700',color:eCol}}>{gemAtkStaked} RP</div>
                    <div style={{fontSize: '15px',color:T.textDim,marginTop:'2px'}}>
                      {gemOppFlow ? 'Opportunity cast · damage ×1' : 'Multiplier · auto-hits'}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'3px'}}>FORMULA</div>
                    <div style={{fontSize: '18px',color:T.text}}>
                      {gemOppFlow ? `${nd}d${dt} × 1` : `${nd}d${dt} × ${gemAtkStaked}`}
                    </div>
                  </div>
                </div>

                {/* Step 1: Crit roll */}
                <div style={{marginBottom:'12px'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.14em',color:T.textMuted,marginBottom:'8px'}}>STEP 1 — CRITICAL HIT ROLL</div>
                  {gemAtkCritRoll===null
                    ? <button type="button" onClick={doGemCritRoll} style={{...Btn('#e8a020'),padding:'11px',width:'100%',background:'#1a1000',fontSize: '15px',letterSpacing:'0.1em'}}>⬡ ROLL FOR CRIT (d20)</button>
                    : <div style={{background:gemAtkIsCrit?'#1a1200':'#0c0c10',border:`1px solid ${gemAtkIsCrit?'#e8a02066':'#2a2a40'}`,borderRadius:'3px',padding:'12px',display:'flex',alignItems:'center',gap:'16px'}}>
                        <div style={{fontSize: '41px',fontWeight:'700',color:gemAtkIsCrit?'#e8a020':T.text,lineHeight:1}}>{gemAtkCritRoll}</div>
                        <div>
                          {gemAtkIsCrit
                            ? <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.14em',color:'#e8a020'}}>⭑ CRITICAL HIT</div>
                            : <div style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.textMuted}}>No crit <span style={{color:T.textDim}}>(need 20)</span></div>
                          }
                          <div style={{fontSize: '15px',color:T.textDim,marginTop:'2px'}}>Rolled {gemAtkCritRoll} on d20</div>
                        </div>
                      </div>
                  }
                </div>

                {/* Step 2: Damage roll */}
                <div style={{marginBottom:'12px',opacity:gemAtkCritRoll===null?0.35:1,transition:'opacity 0.2s'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.14em',color:T.textMuted,marginBottom:'8px'}}>STEP 2 — DAMAGE ROLL</div>
                  {!gemAtkResult
                    ? <button type="button" onClick={doGemRoll} disabled={gemAtkCritRoll===null} style={{...Btn(eCol),padding:'11px',width:'100%',background:`${eCol}10`,fontSize: '15px',letterSpacing:'0.1em'}}>
                        ⚡ ROLL DAMAGE {gemAtkIsCrit&&<span style={{color:'#e8a020'}}> · ×2 CRIT</span>}
                      </button>
                    : <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                        <div style={{background:gemAtkIsCrit?'#1a1200':'#0c0c10',border:`1px solid ${gemAtkIsCrit?'#e8a02044':eCol+'33'}`,borderRadius:'3px',padding:'12px',display:'flex',alignItems:'center',gap:'16px'}}>
                          <div style={{fontSize: '41px',fontWeight:'700',color:gemAtkIsCrit?'#e8a020':eCol,lineHeight:1}}>{gemAtkResult.sum}</div>
                          <div style={{flex:1}}>
                            <div style={{fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.1em',color:eCol,marginBottom:'3px'}}>{gemAtkGem.element.toUpperCase()}</div>
                            <div style={{fontSize: '15px',color:T.textDim}}>
                              {gemAtkResult.rolls.length>1?`(${gemAtkResult.rolls.join('+')}=${gemAtkResult.sum})`:gemAtkResult.rolls[0]}
                              {gemOppFlow ? ' × 1 (opportunity)' : ` × ${gemAtkResult.rpUsed} RP`}
                              {gemAtkIsCrit?' × 2 CRIT':''}
                            </div>
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'2px'}}>DMG</div>
                            <div style={{fontWeight:'700',fontSize: '25px',color:gemAtkIsCrit?'#e8a020':eCol}}>{fmtNum(gemAtkResult.dmg)}</div>
                          </div>
                        </div>
                        <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>
                            {gemAtkIsCrit
                              ? <span style={{color:'#e8a020'}}>⭑ CRITICAL HIT — doubled</span>
                              : <span style={{color:eCol}}>AUTO-HIT · NO SAVE</span>
                            }
                          </div>
                          <div style={{textAlign:'right'}}>
                            <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginBottom:'2px'}}>TOTAL DAMAGE</div>
                            <div style={{color:gemAtkIsCrit?'#e8a020':eCol,fontWeight:'700',fontSize: '31px'}}>{fmtNum(gemAtkResult.dmg)}</div>
                          </div>
                        </div>
                        {gemAtkGem.notes&&<div style={{padding:'8px 12px',background:T.surface,borderRadius:'3px',border:`1px solid ${eCol}22`,fontSize: '15px',color:eCol}}>✦ {gemAtkGem.notes}</div>}
                      </div>
                  }
                </div>

                {gemAtkResult
                  ? <button onClick={closeGemAtk} style={{...Btn(eCol),padding:'10px',width:'100%',background:`${eCol}10`,fontSize: '15px',letterSpacing:'0.1em'}}>CLOSE</button>
                  : <button onClick={closeGemAtk} style={{...Btn(T.textMuted),padding:'8px',width:'100%',fontSize: '14px'}}>CANCEL (RP spent)</button>
                }
              </>
            )}
          </ModalWrap>
        );
      })()}

      {/* Damage Modal */}
      {dModal==='damage'&&(
        <ModalWrap accentColor={T.hp} minW="440px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:T.hp,marginBottom:'16px'}}>APPLY DAMAGE</div>
          {dmgLines.map((e,ei)=>(
            <div key={ei} style={{display:'flex',gap:'7px',marginBottom:'8px',alignItems:'center'}}>
              <StableNumInput
                value={Number(e.amount)||0}
                onChange={v=>setDmgAmount(ei,String(v))}
                min={0}
                style={{...inp(),width:'115px',textAlign:'center',fontSize: '21px'}}
                placeholder="Amount"
              />
              <select value={e.type} onChange={x=>setDmgType(ei,x.target.value)} style={{...inp(),flex:1,color:e.type==='Physical'?T.text:ELEM_COLOR[e.type]}}>
                {DMG_TYPES.map(t=><option key={t} style={{color:t==='Physical'?T.text:ELEM_COLOR[t]}}>{t}</option>)}
              </select>
              {dmgLines.length>1&&<button onClick={()=>{setDmgLines(p=>p.filter((_,i)=>i!==ei));setDmgResult(null);}} style={{...Btn('#662020'),padding:'5px 9px'}}>✕</button>}
            </div>
          ))}
          <button onClick={()=>{setDmgLines(p=>[...p,{amount:'',type:'Physical'}]);setDmgResult(null);}} style={{...Btn(T.textMuted),padding:'5px 14px',fontSize: '14px',marginBottom:'14px'}}>+ ADD DAMAGE TYPE</button>
          {!dmgResult&&<button onClick={computeDmg} style={{...Btn(T.hp),padding:'10px',width:'100%',fontSize: '15px',background:'#2a0808',marginBottom:'12px'}}>CALCULATE DAMAGE</button>}
          {dmgResult&&(
            <div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'3px',padding:'12px',marginBottom:'12px'}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,letterSpacing:'0.12em',marginBottom:'10px'}}>BREAKDOWN</div>
              {dmgResult.res.map((l,li)=>(
                <div key={li} style={{display:'flex',gap:'8px',alignItems:'center',marginBottom:'6px',fontSize: '17px',flexWrap:'wrap'}}>
                  <span style={{color:l.color,fontWeight:'500',minWidth:'140px'}}>{l.label}</span>
                  <span style={{color:T.textMuted,fontSize: '15px',flex:1}}>{l.detail}</span>
                  <span style={{color:l.heal?'#50c050':T.hp,fontWeight:'700',fontSize: '20px'}}>{l.heal?'+':''}{fmtNum(Math.abs(l.change))}</span>
                </div>
              ))}
              <div style={{borderTop:`1px solid ${T.border}`,marginTop:'10px',paddingTop:'10px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted}}>NET HP CHANGE</span>
                <span style={{color:dmgResult.net<0?T.hp:'#50c050',fontSize: '25px',fontWeight:'700'}}>{dmgResult.net>=0?'+':''}{fmtNum(dmgResult.net)}</span>
              </div>
              <div style={{fontSize: '16px',color:T.textMuted,marginTop:'6px',textAlign:'center'}}>
                <strong style={{color:T.text}}>{fmtNum(curHP)}</strong> → <strong style={{color:T.text}}>{fmtNum(Math.max(0,Math.min(maxHP,curHP+dmgResult.net)))}</strong> / {fmtNum(maxHP)}
              </div>
            </div>
          )}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <button onClick={()=>setDModal(null)} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
            <button onClick={confirmDmg} disabled={!dmgResult} style={{...Btn(T.hp),padding:'10px',background:'#2a0808',opacity:dmgResult?1:0.28,fontSize: '15px'}}>CONFIRM</button>
          </div>
        </ModalWrap>
      )}

      {/* Heal Modal */}
      {dModal==='heal'&&(
        <ModalWrap accentColor="#50a050" minW="320px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:'#50a050',marginBottom:'16px'}}>APPLY HEALING</div>
          <Fld label="HP to Restore" style={{marginBottom:'16px'}}>
            <input type="number" value={healAmt} min={1} onChange={e=>setHealAmt(e.target.value)} placeholder="Enter healing amount…"
              style={{...inp(),textAlign:'center',fontSize: '29px',color:'#60d060',padding:'8px'}} autoFocus/>
          </Fld>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
            <button onClick={()=>setDModal(null)} style={{...Btn(T.textMuted),padding:'10px'}}>CANCEL</button>
            <button onClick={confirmHeal} disabled={!Number(healAmt)||Number(healAmt)<=0}
              style={{...Btn('#50a050'),padding:'10px',background:'#062006',fontSize: '15px',opacity:Number(healAmt)>0?1:0.28}}>✦ HEAL</button>
          </div>
        </ModalWrap>
      )}

      {/* Portaled to document.body so position:fixed is viewport-relative (ancestor .page-enter uses transform from pageFadeIn). */}
      {typeof document !== 'undefined' && createPortal(
      diceLogCollapsed ? (
        <div
          style={{
            position: 'fixed',
            right: '16px',
            top: '86px',
            zIndex: 980,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '8px',
            maxWidth: 'min(320px, calc(100vw - 32px))',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setDiceLogCollapsed(false);
            }}
            title="Expand dice log"
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 14px',
              background: '#0d1018ee',
              border: `1px solid ${T.border}`,
              borderRadius: '6px',
              boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
              cursor: 'pointer',
              fontFamily: "'Cinzel',serif",
            }}
          >
            <span style={{ color: T.textMuted, fontSize: '14px', flexShrink: 0 }} aria-hidden>
              ◀
            </span>
            <span
              style={{
                color: T.gold,
                fontSize: '13px',
                letterSpacing: '0.2em',
              }}
            >
              Dice log
            </span>
          </button>
        </div>
      ) : (
        <div
          style={{
            position: 'fixed',
            right: '16px',
            top: '86px',
            width: '300px',
            maxHeight: 'min(60vh, 440px)',
            zIndex: 980,
            background: '#0d1018ee',
            border: `1px solid ${T.border}`,
            borderRadius: '6px',
            boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <button
            type="button"
            onClick={() => {
              setDiceLogCollapsed(true);
            }}
            title="Collapse dice log"
            style={{
              display: 'grid',
              gridTemplateColumns: '40px 1fr 40px',
              alignItems: 'center',
              flexShrink: 0,
              width: '100%',
              border: 'none',
              borderBottom: `1px solid ${T.border}`,
              borderRadius: 0,
              background: 'transparent',
              cursor: 'pointer',
              padding: '10px 0',
              fontFamily: "'Cinzel',serif",
            }}
          >
            <span aria-hidden />
            <span
              style={{
                textAlign: 'center',
                fontSize: '12px',
                letterSpacing: '0.18em',
                color: T.textMuted,
              }}
            >
              Dice log
            </span>
            <span style={{ color: T.textMuted, fontSize: '14px', textAlign: 'center' }} aria-hidden>
              ▶
            </span>
          </button>
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <DiceLog entries={sessionDiceLog} userId={rollUserId} isDM={false} />
          </div>
        </div>
      )
      , document.body)}

      <StateEffectTooltip tip={stateTip} />

      {/* ── Context Menu ─────────────────────────────────────────────── */}
      {ctxMenu&&(
        <>
          <div onClick={closeCtx} style={{position:'fixed',inset:0,zIndex:1000}}/>
          <div style={{position:'fixed',left:ctxMenu.x,top:ctxMenu.y,zIndex:1001,
            background:'#0d1018',border:`1px solid ${ATTR_COLOR[ctxMenu.attr]}44`,
            borderRadius:'4px',minWidth:'200px',boxShadow:'0 8px 32px #00000088',
            overflow:'hidden'}}>
            {/* Header */}
            <div style={{padding:'8px 14px 6px',borderBottom:`1px solid ${ATTR_COLOR[ctxMenu.attr]}22`,
              fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.2em',
              color:ATTR_COLOR[ctxMenu.attr],opacity:0.7}}>{ctxMenu.attr.toUpperCase()} ROLL</div>
            {/* Normal */}
            {[
              {label:'Normal Roll',    mode:'normal',        icon:'⬡'},
              {label:'With Advantage', mode:'advantage',     icon:'⬆'},
              {label:'With Disadvantage',mode:'disadvantage',icon:'⬇'},
            ].map(({label,mode,icon})=>(
              <button key={mode} onClick={()=>{closeCtx();rollSave(ctxMenu.attr,mode);}}
                style={{display:'block',width:'100%',textAlign:'left',background:'transparent',
                  border:'none',borderBottom:`1px solid ${ATTR_COLOR[ctxMenu.attr]}11`,
                  padding:'10px 14px',color:'#e4d8c0',fontSize: '16px',cursor:'pointer',
                  fontFamily:'inherit',transition:'background 0.1s'}}
                onMouseEnter={e=>e.currentTarget.style.background=ATTR_COLOR[ctxMenu.attr]+'18'}
                onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                <span style={{marginRight:'10px',opacity:0.6}}>{icon}</span>{label}
              </button>
            ))}
            {/* Defensive — Power and Agility only */}
            {(ctxMenu.attr==='Power'||ctxMenu.attr==='Agility')&&(
              <>
                <div style={{height:'1px',background:ATTR_COLOR[ctxMenu.attr]+'33',margin:'2px 0'}}/>
                <button onClick={()=>{closeCtx();setDefRpInput(0);setDefModal({attr:ctxMenu.attr});}}
                  style={{display:'block',width:'100%',textAlign:'left',background:'transparent',
                    border:'none',padding:'10px 14px',color:ATTR_COLOR[ctxMenu.attr],
                    fontSize: '16px',cursor:'pointer',fontFamily:'inherit',transition:'background 0.1s'}}
                  onMouseEnter={e=>e.currentTarget.style.background=ATTR_COLOR[ctxMenu.attr]+'18'}
                  onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                  <span style={{marginRight:'10px',opacity:0.6}}>🛡</span>
                  {ctxMenu.attr==='Power' ? 'Defensive Save (Block)' : 'Defensive Save (Dodge)'}
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Defensive Save Pre-Roll ──────────────────────────────────── */}
      {defModal&&(()=>{
        const ac   = ATTR_COLOR[defModal.attr];
        const rpIn = Math.max(0, Math.min(Number(defRpInput)||0, curRP));
        const defBonus = defensiveBonusFromCommit(rpIn, effBaseRP);
        const pctOfBase = effBaseRP > 0 ? Math.round((rpIn / effBaseRP) * 1000) / 10 : 0;
        return(
          <ModalWrap accentColor={ac} minW="380px">
            <div style={{textAlign:'center',padding:'8px 0'}}>
              <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.28em',color:ac,marginBottom:'4px',opacity:0.7}}>DEFENSIVE SAVE</div>
              <div style={{fontSize: '15px',color:T.textMuted,marginBottom:'12px',lineHeight:1.5}}>
                Save roll = d20 + resistance modifier + defensive bonus (+0–+5). Bonus tiers use <strong style={{color:T.gold}}>Base RP</strong> ({effBaseRP}) as reference; you may commit up to your <strong style={{color:T.rp}}>available RP</strong> ({curRP}).
              </div>

              <div style={{marginBottom:'14px',textAlign:'left'}}>
                <div style={{...LBL,marginBottom:'8px'}}>Resistance (narrative)</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                  <button
                    type="button"
                    onClick={()=>setDefModal(d=>d&&{...d,attr:'Power'})}
                    style={{...Btn(ATTR_COLOR.Power),padding:'10px',fontSize: '14px',background:defModal.attr==='Power'?`${ATTR_COLOR.Power}22`:'transparent',opacity:defModal.attr==='Power'?1:0.75}}
                  >
                    Power — Block
                  </button>
                  <button
                    type="button"
                    onClick={()=>setDefModal(d=>d&&{...d,attr:'Agility'})}
                    style={{...Btn(ATTR_COLOR.Agility),padding:'10px',fontSize: '14px',background:defModal.attr==='Agility'?`${ATTR_COLOR.Agility}22`:'transparent',opacity:defModal.attr==='Agility'?1:0.75}}
                  >
                    Agility — Dodge
                  </button>
                </div>
                <div style={{fontSize: '15px',color:T.textMuted,marginTop:'8px'}}>
                  Modifier on die: <strong style={{color:ac}}>{mStr(calcMod(attrs[defModal.attr]))}</strong> ({defModal.attr})
                </div>
              </div>

              <div style={{background:'#111520',border:`1px solid ${ac}33`,borderRadius:'4px',padding:'14px 18px',marginBottom:'14px',textAlign:'left'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'8px'}}>
                  <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',letterSpacing:'0.18em',color:'#8a7a68'}}>RP COMMITTED (spent on roll)</div>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:T.rp}}>
                    Available: <strong>{curRP}</strong>
                  </span>
                </div>
                <div style={{display:'flex',gap:'12px',alignItems:'center',marginBottom:'8px'}}>
                  <div style={{display:'flex',alignItems:'stretch',flexShrink:0}}>
                    <button type="button" onClick={()=>setDefRpInput(v=>Math.max(0,(Number(v)||0)-1))}
                      style={{...Btn(ac),padding:'0 12px',fontSize: '25px',fontWeight:'300',borderRight:'none',borderRadius:'3px 0 0 3px',lineHeight:1}}>−</button>
                    <StableNumInput
                      value={rpIn}
                      onChange={setDefRpInput}
                      min={0}
                      max={curRP}
                      clearOnFocus
                      style={{...inp(),width:'72px',textAlign:'center',fontSize: '25px',fontWeight:'700',color:ac,borderRadius:0,borderLeft:'none',borderRight:'none',padding:'4px 6px'}}
                    />
                    <button type="button" onClick={()=>setDefRpInput(v=>Math.min(curRP,(Number(v)||0)+1))}
                      style={{...Btn(ac),padding:'0 12px',fontSize: '25px',fontWeight:'300',borderLeft:'none',borderRadius:'0 3px 3px 0',lineHeight:1}}>+</button>
                  </div>
                  <div style={{flex:1,position:'relative',padding:'10px 0'}}>
                    <div style={{height:'6px',background:'#1c2030',borderRadius:'3px',position:'relative',overflow:'visible'}}>
                      <div
                        style={{
                          height:'100%',
                          width:`${curRP>0?Math.min(100,(rpIn/curRP)*100):0}%`,
                          background:ac,
                          borderRadius:'3px',
                        }}
                      />
                      <div
                        style={{
                          position:'absolute',
                          top:'50%',
                          transform:'translateY(-50%)',
                          left:`calc(${curRP>0?Math.min(100,(rpIn/curRP)*100):0}% - 8px)`,
                          width:'16px',
                          height:'16px',
                          borderRadius:'50%',
                          background:ac,
                          boxShadow:`0 0 7px ${ac}99`,
                          pointerEvents:'none',
                        }}
                      />
                    </div>
                    <input
                      key={`def-rp-max-${curRP}`}
                      type="range"
                      min={0}
                      max={curRP||1}
                      value={rpIn}
                      onChange={e=>{
                        const mx = curRP || 1;
                        const v = Math.max(0, Math.min(mx, Number(e.target.value) || 0));
                        setDefRpInput(v);
                      }}
                      style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',width:'100%',height:'100%',margin:0,padding:0}}
                    />
                  </div>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'6px'}}>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:'#8a7a68'}}>vs Base RP (bonus tiers)</span>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize: '14px',color:ac,whiteSpace:'nowrap'}}>+{defBonus} defensive bonus</span>
                </div>
                <div style={{display:'flex',gap:'4px',marginBottom:'2px'}}>
                  {[1,2,3,4,5].map(i=>(
                    <div
                      key={i}
                      style={{
                        flex:1,
                        height:'7px',
                        borderRadius:'2px',
                        background:i<=defBonus?ac:'#1c2230',
                        transition:'background 0.12s',
                      }}
                    />
                  ))}
                </div>
                <div style={{fontSize: '14px',color:'#504538',marginTop:'8px',lineHeight:1.5}}>
                  {rpIn === 0
                    ? '0% of Base RP → +0 defensive bonus.'
                    : `${pctOfBase}% of Base RP → +${defBonus} on the d20 roll (max +5).`}
                </div>
              </div>

              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <button type="button" onClick={()=>setDefModal(null)} style={{...Btn('#8a7a68'),padding:'10px',fontSize: '14px'}}>CANCEL</button>
                <button type="button" onClick={()=>{setDefModal(null);rollSave(defModal.attr,'defensive',rpIn);}}
                  style={{...Btn(ac),padding:'10px',fontSize: '15px',background:`${ac}15`,fontWeight:'600'}}>
                  🎲 ROLL SAVE
                </button>
              </div>
            </div>
          </ModalWrap>
        );
      })()}

      {/* ══ WEAPON BROWSER ════════════════════════════════════════════ */}
      {wepModal==='browseWeapon'&&(
        <ModalWrap accentColor="#c8503a" minW="580px">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:'#c8503a'}}>WEAPON DATABASE</div>
            <div style={{display:'flex',gap:'4px'}}>
              {['All','My Homebrew'].map(lbl=>{
                const mine=lbl==='My Homebrew';
                const active=libShowMine===mine;
                return(
                  <button key={lbl} onClick={()=>{
                    setLibShowMine(mine);setLibExpanded(null);setLibLoading(true);
                    api.get(mine?'/library/weapons/mine':'/library/weapons').then(r=>{setLibWeapons(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));
                  }} style={{...Btn(active?'#c8503a':'#3a2a28'),padding:'3px 10px',fontSize: '13px',background:active?'#1a0604':'transparent'}}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'8px',marginBottom:'10px'}}>
            <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="Search weapons…" style={inp()}/>
            <select value={libRarityFilter} onChange={e=>setLibRarityFilter(e.target.value)} style={{...inp(),width:'120px'}}>
              <option value="">All Rarities</option>
              {['common','uncommon','rare','epic','legendary','mythic'].map(r=><option key={r} value={r}>{cap(r)}</option>)}
            </select>
          </div>
          <div style={{maxHeight:'400px',overflowY:'auto',border:`1px solid ${T.border}`,borderRadius:'3px'}}>
            {libLoading&&<div style={{padding:'24px',textAlign:'center',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!libLoading&&libWeapons
              .filter(w=>{
                const matchName=!libSearch||w.name.toLowerCase().includes(libSearch.toLowerCase());
                const matchRar=!libRarityFilter||w.rarity===libRarityFilter;
                return matchName&&matchRar;
              })
              .map(w=>{
                const sheetW=libWeaponToSheet(w);
                const rarCol=RARITY_COLOR[cap(w.rarity)]||T.textMuted;
                const isExp=libExpanded===w.id;
                const canAddWeapon = meetsWeaponLibStats(w);
                const doAdd=()=>{
                  if (!canAddWeapon) return;
                  addToInventory('weapon', w.id);
                  setWepModal(null);
                };
                return(
                  <div key={w.id} style={{borderBottom:`1px solid ${T.border}`,background:isExp?'#0f1220':'transparent'}}>
                    {/* Row header */}
                    <div onClick={()=>setLibExpanded(isExp?null:w.id)}
                      className="tr-hover"
                      style={{padding:'10px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:'500',color:rarCol}}>{w.name}</span>
                        <span style={{fontSize: '15px',color:T.textMuted,marginLeft:'10px'}}>
                          {sheetW.channels.map((ch,i)=><span key={i}>{i>0?' + ':''}{ch.dice}d{w.base_die_type} <span style={{color:ch.element==='Physical'?T.textMuted:ELEM_COLOR[ch.element]}}>{ch.element}</span></span>)}
                          <span style={{color:T.textDim}}> × RP</span>
                        </span>
                      </div>
                      <button type="button" onClick={e=>{e.stopPropagation();doAdd();}}
                        disabled={!canAddWeapon}
                        title={!canAddWeapon ? (equipStatRequirementMessage('weapon', w) || 'Requirements not met') : 'Add to inventory'}
                        style={{...Btn('#c8503a'),padding:'3px 14px',fontSize: '14px',background:'#1a0604',flexShrink:0,opacity:canAddWeapon?1:0.35}}>
                        + ADD
                      </button>
                    </div>
                    {/* Expanded detail */}
                    {isExp&&(
                      <div style={{padding:'0 14px 12px 14px',fontSize: '16px',color:T.textMuted,display:'flex',flexDirection:'column',gap:'5px'}}>
                        {w.description&&<div style={{fontStyle:'italic',color:T.textMuted,marginBottom:'2px'}}>{w.description}</div>}
                        <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>RARITY </span><span style={{color:rarCol}}>{cap(w.rarity)}</span></span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>DIE </span>d{w.base_die_type}</span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>BUDGET </span>{w.total_dice_budget} dice</span>
                          {w.gem_slots>0&&<span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>GEM SLOTS </span>{w.gem_slots}</span>}
                          {sheetW.attrReq&&<span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>REQ </span><span style={{color:'#e8b050'}}>{sheetW.attrReq}</span></span>}
                        </div>
                        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',marginTop:'2px'}}>
                          {sheetW.channels.map((ch,i)=>(
                            <span key={i} style={{padding:'2px 9px',borderRadius:'8px',background:`${ch.element==='Physical'?T.text:ELEM_COLOR[ch.element]}18`,border:`1px solid ${ch.element==='Physical'?T.border:ELEM_COLOR[ch.element]+'44'}`,color:ch.element==='Physical'?T.text:ELEM_COLOR[ch.element],fontSize: '15px'}}>
                              {ch.dice}d{w.base_die_type} {ch.element}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            }
            {!libLoading&&libWeapons.filter(w=>(!libSearch||w.name.toLowerCase().includes(libSearch.toLowerCase()))&&(!libRarityFilter||w.rarity===libRarityFilter)).length===0&&(
              <div style={{padding:'24px',textAlign:'center',color:T.textDim,fontSize: '16px'}}>No weapons match your filters.</div>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',marginTop:'12px'}}>
            <button onClick={()=>setWepModal(null)} style={{...Btn(T.textMuted),padding:'9px'}}>CANCEL</button>
            <button onClick={()=>{setWepModal(null);addManualWep();}} style={{...Btn('#c8503a'),padding:'9px',background:'#1a0804'}}>+ ADD MANUALLY</button>
            <a href="/homebrew" target="_blank" rel="noopener" style={{...Btn('#c8503a'),padding:'9px',textDecoration:'none',textAlign:'center',fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.1em',display:'block',boxSizing:'border-box'}}>✦ WORKSHOP</a>
          </div>
        </ModalWrap>
      )}

      {/* ══ ARMOR BROWSER ═════════════════════════════════════════════ */}
      {wepModal==='browseArmor'&&(
        <ModalWrap accentColor="#8a7040" minW="600px">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:'#8a7040'}}>ARMOR DATABASE</div>
            <div style={{display:'flex',gap:'4px'}}>
              {['All','My Homebrew'].map(lbl=>{
                const mine=lbl==='My Homebrew';
                const active=libShowMine===mine;
                return(
                  <button key={lbl} onClick={()=>{
                    setLibShowMine(mine);setLibExpanded(null);setLibLoading(true);
                    api.get(mine?'/library/armor/mine':'/library/armor').then(r=>{setLibArmor(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));
                  }} style={{...Btn(active?'#8a7040':'#3a3020'),padding:'3px 10px',fontSize: '13px',background:active?'#100c02':'transparent'}}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'8px',marginBottom:'10px'}}>
            <select value={libSlotFilter} onChange={e=>setLibSlotFilter(e.target.value)} style={inp()}>
              <option value="">All Slots</option>
              {ARMOR_SLOTS.map(s=><option key={s} value={s.toLowerCase()}>{s}</option>)}
            </select>
            <select value={libRarityFilter} onChange={e=>setLibRarityFilter(e.target.value)} style={inp()}>
              <option value="">All Rarities</option>
              {['common','uncommon','rare','epic'].map(r=><option key={r} value={r}>{cap(r)}</option>)}
            </select>
            <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="Search…" style={inp()}/>
          </div>
          <div style={{maxHeight:'400px',overflowY:'auto',border:`1px solid ${T.border}`,borderRadius:'3px'}}>
            {libLoading&&<div style={{padding:'24px',textAlign:'center',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!libLoading&&libArmor
              .filter(a=>{
                const matchSlot=!libSlotFilter||a.slot===libSlotFilter;
                const matchRar=!libRarityFilter||a.rarity===libRarityFilter;
                const matchName=!libSearch||a.name.toLowerCase().includes(libSearch.toLowerCase());
                return matchSlot&&matchRar&&matchName;
              })
              .map(a=>{
                const rarCol=RARITY_COLOR[cap(a.rarity)]||T.textMuted;
                const slot=cap(a.slot);
                const isExp=libExpanded===a.id;
                const canAddArmor = meetsArmorLibStats(a);
                const doAdd=()=>{
                  if (!canAddArmor) return;
                  addToInventory('armor', a.id);
                  setWepModal(null);
                };
                return(
                  <div key={a.id} style={{borderBottom:`1px solid ${T.border}`,background:isExp?'#0f1220':'transparent'}}>
                    <div onClick={()=>setLibExpanded(isExp?null:a.id)}
                      className="tr-hover"
                      style={{padding:'10px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:'500',color:rarCol}}>{a.name}</span>
                        <span style={{fontSize: '15px',color:T.textMuted,marginLeft:'10px'}}>
                          <span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:'#8a7040'}}>{slot}</span>
                          <span style={{marginLeft:'8px'}}>{parseFloat(a.mitigation_percent)}% mit</span>
                          {a.req_power>0&&<span style={{color:T.textDim,marginLeft:'8px'}}>· PWR {a.req_power}+</span>}
                        </span>
                      </div>
                      <button type="button" onClick={e=>{e.stopPropagation();doAdd();}}
                        disabled={!canAddArmor}
                        title={!canAddArmor ? (equipStatRequirementMessage('armor', a) || 'Requirements not met') : 'Add to inventory'}
                        style={{...Btn('#8a7040'),padding:'3px 14px',fontSize: '14px',background:'#100c02',flexShrink:0,opacity:canAddArmor?1:0.35}}>
                        + ADD
                      </button>
                    </div>
                    {isExp&&(
                      <div style={{padding:'0 14px 12px 14px',fontSize: '16px',color:T.textMuted,display:'flex',flexDirection:'column',gap:'5px'}}>
                        {a.description&&<div style={{fontStyle:'italic',marginBottom:'2px'}}>{a.description}</div>}
                        <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>RARITY </span><span style={{color:rarCol}}>{cap(a.rarity)}</span></span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>CATEGORY </span>{cap(a.category)}</span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>MITIGATION </span><span style={{color:T.text,fontWeight:'600'}}>{parseFloat(a.mitigation_percent)}%</span></span>
                          {a.gem_slots>0&&<span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>GEM SLOTS </span>{a.gem_slots}</span>}
                          {a.req_power>0&&<span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>REQ </span><span style={{color:'#e8b050'}}>PWR {a.req_power}</span></span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            }
            {!libLoading&&libArmor.filter(a=>(!libSlotFilter||a.slot===libSlotFilter)&&(!libRarityFilter||a.rarity===libRarityFilter)&&(!libSearch||a.name.toLowerCase().includes(libSearch.toLowerCase()))).length===0&&(
              <div style={{padding:'24px',textAlign:'center',color:T.textDim,fontSize: '16px'}}>No armor pieces match your filters.</div>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'12px'}}>
            <button onClick={()=>setWepModal(null)} style={{...Btn(T.textMuted),padding:'9px'}}>CLOSE</button>
            <a href="/homebrew" target="_blank" rel="noopener" style={{...Btn('#8a7040'),padding:'9px',textDecoration:'none',textAlign:'center',fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.1em',display:'block',boxSizing:'border-box'}}>✦ WORKSHOP</a>
          </div>
        </ModalWrap>
      )}

      {/* ══ GEM BROWSER ═══════════════════════════════════════════════ */}
      {wepModal==='browseGem'&&(
        <ModalWrap accentColor={T.magic} minW="560px">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'4px'}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:T.magic}}>SPELL GEM DATABASE</div>
            <div style={{display:'flex',gap:'4px'}}>
              {['All','My Homebrew'].map(lbl=>{
                const mine=lbl==='My Homebrew';
                const active=libShowMine===mine;
                return(
                  <button key={lbl} onClick={()=>{
                    setLibShowMine(mine);setLibExpanded(null);setLibLoading(true);
                    api.get(mine?'/library/spell-gems/mine':'/library/spell-gems').then(r=>{setLibGems(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));
                  }} style={{...Btn(active?T.magic:'#302040'),padding:'3px 10px',fontSize: '13px',background:active?'#0a0618':'transparent'}}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{fontSize: '16px',color:T.textMuted,marginBottom:'12px'}}>Equipping to: <span style={{color:T.magic}}>Slot {gemTargetSlot+1}</span></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginBottom:'10px'}}>
            <select value={libElemFilter} onChange={e=>setLibElemFilter(e.target.value)} style={inp()}>
              <option value="">All Elements</option>
              {['fire','ice','lightning','shadow','arcane','poison','earth','wind','light','nature'].map(el=>(
                <option key={el} value={el} style={{color:ELEM_COLOR[libGemElement(el)]||T.text}}>{libGemElement(el)}</option>
              ))}
            </select>
            <select value={libRarityFilter} onChange={e=>setLibRarityFilter(e.target.value)} style={inp()}>
              <option value="">All Rarities</option>
              {['common','uncommon','rare','epic','legendary'].map(r=><option key={r} value={r}>{cap(r)}</option>)}
            </select>
          </div>
          <div style={{maxHeight:'380px',overflowY:'auto',border:`1px solid ${T.border}`,borderRadius:'3px'}}>
            {libLoading&&<div style={{padding:'24px',textAlign:'center',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!libLoading&&libGems
              .filter(g=>(!libElemFilter||g.element_type===libElemFilter)&&(!libRarityFilter||g.rarity===libRarityFilter))
              .map(g=>{
                const elem=libGemElement(g.element_type);
                const eCol=ELEM_COLOR[elem]||T.text;
                const rarCol=RARITY_COLOR[cap(g.rarity)]||T.textMuted;
                const isExp=libExpanded===g.id;
                const doAdd=()=>{
                  addToInventory('spell_gem', g.id);
                  setWepModal(null);
                };
                return(
                  <div key={g.id} style={{borderBottom:`1px solid ${T.border}`,background:isExp?'#0a0818':'transparent'}}>
                    <div onClick={()=>setLibExpanded(isExp?null:g.id)}
                      className="tr-hover"
                      style={{padding:'10px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{width:'9px',height:'9px',borderRadius:'50%',background:eCol,boxShadow:`0 0 7px ${eCol}66`,flexShrink:0}}/>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:'500',color:rarCol}}>{g.name}</span>
                        <span style={{fontSize: '15px',color:T.textMuted,marginLeft:'10px'}}>
                          <span style={{color:eCol}}>{g.num_dice}d{g.die_type}</span>
                          <span style={{color:T.textDim}}> × RP · auto-hit</span>
                        </span>
                      </div>
                      <button onClick={e=>{e.stopPropagation();doAdd();}}
                        style={{...Btn(T.magic),padding:'3px 14px',fontSize: '14px',background:'#0a0618',flexShrink:0}}>
                        + ADD
                      </button>
                    </div>
                    {isExp&&(
                      <div style={{padding:'0 14px 12px 14px',fontSize: '16px',color:T.textMuted,display:'flex',flexDirection:'column',gap:'5px'}}>
                        {g.description&&<div style={{fontStyle:'italic',marginBottom:'2px'}}>{g.description}</div>}
                        <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>RARITY </span><span style={{color:rarCol}}>{cap(g.rarity)}</span></span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>ELEMENT </span><span style={{color:eCol}}>{elem}</span></span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>DAMAGE </span><span style={{color:eCol,fontWeight:'600'}}>{g.num_dice}d{g.die_type} × RP</span></span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>ARMOR RES </span>+{g.armor_resistance_percent}%</span>
                        </div>
                        {g.secondary_effect&&(
                          <div style={{padding:'5px 10px',background:T.surface,borderRadius:'3px',border:`1px solid ${eCol}22`,fontSize: '15px',color:eCol}}>
                            ✦ {g.secondary_effect}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            }
            {!libLoading&&libGems.filter(g=>(!libElemFilter||g.element_type===libElemFilter)&&(!libRarityFilter||g.rarity===libRarityFilter)).length===0&&(
              <div style={{padding:'24px',textAlign:'center',color:T.textDim,fontSize: '16px'}}>No gems match your filters.</div>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'12px'}}>
            <button onClick={()=>setWepModal(null)} style={{...Btn(T.textMuted),padding:'9px'}}>CLOSE</button>
            <a href="/homebrew" target="_blank" rel="noopener" style={{...Btn(T.magic),padding:'9px',textDecoration:'none',textAlign:'center',fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.1em',display:'block',boxSizing:'border-box'}}>✦ WORKSHOP</a>
          </div>
        </ModalWrap>
      )}
      {/* ══ FOCUS BRACER BROWSER ═════════════════════════════════════ */}
      {wepModal==='browseBracer'&&(
        <ModalWrap accentColor={T.magic} minW="500px">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px'}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:T.magic}}>FOCUS BRACER DATABASE</div>
            <div style={{display:'flex',gap:'4px'}}>
              {['All','My Homebrew'].map(lbl=>{
                const mine=lbl==='My Homebrew';
                const active=libShowMine===mine;
                return(
                  <button key={lbl} onClick={()=>{
                    setLibShowMine(mine);setLibExpanded(null);setLibLoading(true);
                    api.get(mine?'/library/focus-bracers/mine':'/library/focus-bracers').then(r=>{setLibBracers(r.data.data);setLibLoading(false);}).catch(()=>setLibLoading(false));
                  }} style={{...Btn(active?T.magic:'#302040'),padding:'3px 10px',fontSize: '13px',background:active?'#0a0618':'transparent'}}>
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
          <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="Search bracers…" style={{...inp(),marginBottom:'10px'}}/>
          <div style={{maxHeight:'400px',overflowY:'auto',border:`1px solid ${T.border}`,borderRadius:'3px'}}>
            {libLoading&&<div style={{padding:'24px',textAlign:'center',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!libLoading&&libBracers
              .filter(b=>!libSearch||b.name.toLowerCase().includes(libSearch.toLowerCase()))
              .map(b=>{
                const isExp=libExpanded===b.id;
                const gradeColor={initiate:'#7060b0',adept:'#9b6fe8',exemplar:'#c060e8',ascendant:'#e080ff'};
                const gCol=gradeColor[b.grade?.toLowerCase()]||T.magic;
                const canAddBracer = meetsBracerLibStats(b);
                return(
                  <div key={b.id} style={{borderBottom:`1px solid ${T.border}`,background:isExp?'#0a0818':'transparent'}}>
                    <div onClick={()=>setLibExpanded(isExp?null:b.id)}
                      className="tr-hover"
                      style={{padding:'10px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:'500',color:T.text}}>{b.name}</span>
                        <span style={{fontSize: '14px',padding:'1px 8px',borderRadius:'8px',marginLeft:'10px',background:`${gCol}15`,border:`1px solid ${gCol}33`,color:gCol}}>{cap(b.grade)}</span>
                        <span style={{fontSize: '15px',color:T.textMuted,marginLeft:'10px'}}>⬡ {b.gem_slots} slots</span>
                        {b.req_focus>0&&<span style={{fontSize: '14px',color:T.textDim,marginLeft:'8px'}}>FOC {b.req_focus}+</span>}
                      </div>
                      <button type="button" onClick={e=>{e.stopPropagation();if(!canAddBracer)return;addToInventory('focus_bracer',b.id);setWepModal(null);}}
                        disabled={!canAddBracer}
                        title={!canAddBracer ? (equipStatRequirementMessage('focus_bracer', b) || 'Requirements not met') : 'Add to inventory'}
                        style={{...Btn(T.magic),padding:'3px 14px',fontSize: '14px',background:'#0a0618',flexShrink:0,opacity:canAddBracer?1:0.35}}>
                        + ADD
                      </button>
                    </div>
                    {isExp&&b.description&&(
                      <div style={{padding:'0 14px 12px 14px',fontSize: '16px',color:T.textMuted,fontStyle:'italic'}}>
                        {b.description}
                      </div>
                    )}
                  </div>
                );
              })
            }
            {!libLoading&&libBracers.filter(b=>!libSearch||b.name.toLowerCase().includes(libSearch.toLowerCase())).length===0&&(
              <div style={{padding:'24px',textAlign:'center',color:T.textDim,fontSize: '16px'}}>No focus bracers found.</div>
            )}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',marginTop:'12px'}}>
            <button onClick={()=>setWepModal(null)} style={{...Btn(T.textMuted),padding:'9px'}}>CLOSE</button>
            <a href="/homebrew" target="_blank" rel="noopener" style={{...Btn(T.magic),padding:'9px',textDecoration:'none',textAlign:'center',fontFamily:"'Cinzel',serif",fontSize: '14px',letterSpacing:'0.1em',display:'block',boxSizing:'border-box'}}>✦ WORKSHOP</a>
          </div>
        </ModalWrap>
      )}

      {/* ══ GENERAL ITEMS BROWSER ════════════════════════════════════ */}
      {wepModal==='browseGeneral'&&(
        <ModalWrap accentColor={T.gold} minW="560px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:T.gold,marginBottom:'12px'}}>GEAR & CONSUMABLES</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:'8px',marginBottom:'10px'}}>
            <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="Search items…" style={inp()}/>
            <select value={libCatFilter} onChange={e=>setLibCatFilter(e.target.value)} style={{...inp(),width:'140px'}}>
              <option value="">All Categories</option>
              {['consumable','tool','light','container','misc'].map(c=><option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </div>
          <div style={{maxHeight:'420px',overflowY:'auto',border:`1px solid ${T.border}`,borderRadius:'3px'}}>
            {libLoading&&<div style={{padding:'24px',textAlign:'center',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!libLoading&&libGenItems
              .filter(item=>{
                const matchCat=!libCatFilter||item.category===libCatFilter;
                const matchName=!libSearch||item.name.toLowerCase().includes(libSearch.toLowerCase());
                return matchCat&&matchName;
              })
              .map(item=>{
                const isExp=libExpanded===item.id;
                const catColor={consumable:'#e87040',tool:'#4a9de8',light:'#f0d050',container:'#8a7040',misc:T.textMuted};
                const col=catColor[item.category]||T.textMuted;
                return(
                  <div key={item.id} style={{borderBottom:`1px solid ${T.border}`,background:isExp?'#0f1008':'transparent'}}>
                    <div onClick={()=>setLibExpanded(isExp?null:item.id)}
                      className="tr-hover"
                      style={{padding:'10px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:'10px'}}>
                      <div style={{flex:1}}>
                        <span style={{fontWeight:'500',color:T.text}}>{item.name}</span>
                        <span style={{fontSize: '14px',padding:'1px 7px',borderRadius:'8px',marginLeft:'10px',background:`${col}15`,border:`1px solid ${col}33`,color:col}}>{cap(item.category)}</span>
                        {item.value_gold>0&&<span style={{fontSize: '14px',color:'#e8c040',marginLeft:'8px'}}>⬡ {item.value_gold}g</span>}
                      </div>
                      <button onClick={e=>{e.stopPropagation();addToInventory('general',item.id);setWepModal(null);}}
                        style={{...Btn(T.gold),padding:'3px 14px',fontSize: '14px',background:'#100e00',flexShrink:0}}>
                        + ADD
                      </button>
                    </div>
                    {isExp&&(
                      <div style={{padding:'0 14px 12px 14px',fontSize: '16px',color:T.textMuted,display:'flex',flexDirection:'column',gap:'5px'}}>
                        <div style={{fontStyle:'italic'}}>{item.description}</div>
                        {item.effect&&<div style={{padding:'5px 10px',background:T.surface,borderRadius:'3px',border:`1px solid ${T.border}`,color:T.text,fontSize: '15px'}}>✦ {item.effect}</div>}
                        <div style={{display:'flex',gap:'16px',flexWrap:'wrap'}}>
                          {Number(item.weight)>0&&<span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>WEIGHT </span>{item.weight} lbs</span>}
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>VALUE </span><span style={{color:'#e8c040'}}>{item.value_gold}g</span></span>
                          <span><span style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textDim}}>STACKABLE </span>{item.stackable?'Yes':'No'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            }
            {!libLoading&&libGenItems.filter(item=>(!libCatFilter||item.category===libCatFilter)&&(!libSearch||item.name.toLowerCase().includes(libSearch.toLowerCase()))).length===0&&(
              <div style={{padding:'24px',textAlign:'center',color:T.textDim,fontSize: '16px'}}>No items match your filters.</div>
            )}
          </div>
          <button onClick={()=>setWepModal(null)} style={{...Btn(T.textMuted),padding:'9px',width:'100%',marginTop:'12px'}}>CLOSE</button>
        </ModalWrap>
      )}

      {/* Pet Browser Modal */}
      {wepModal==='browsePet'&&(
        <ModalWrap accentColor="#9b6fe8" minW="500px">
          <div style={{fontFamily:"'Cinzel',serif",fontSize: '15px',letterSpacing:'0.22em',color:'#9b6fe8',marginBottom:'12px'}}>BOND A COMPANION</div>
          <input
            value={libPetSearch} onChange={e=>setLibPetSearch(e.target.value)}
            placeholder="Search by name or species…"
            style={{...inp(),width:'100%',marginBottom:'12px'}}
          />
          <div style={{maxHeight:'420px',overflowY:'auto',paddingRight:'2px'}}>
            {libPetLoading&&<div style={{textAlign:'center',padding:'24px',color:T.textMuted,fontFamily:"'Cinzel',serif",fontSize: '14px'}}>LOADING…</div>}
            {!libPetLoading&&libPetItems
              .filter(p=>!libPetSearch||p.name.toLowerCase().includes(libPetSearch.toLowerCase())||p.species.toLowerCase().includes(libPetSearch.toLowerCase()))
              .map(p=>(
                <div key={p.id} style={{background:T.surface,border:`1px solid #9b6fe822`,borderRadius:'3px',padding:'10px',marginBottom:'8px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'6px'}}>
                    <div>
                      <div style={{fontWeight:'600',fontSize: '18px',color:'#9b6fe8'}}>{p.name}</div>
                      <div style={{fontFamily:"'Cinzel',serif",fontSize: '13px',color:T.textMuted,marginTop:'2px'}}>{p.species}</div>
                    </div>
                    <button onClick={()=>bondPet(p.id)} style={{...Btn('#9b6fe8'),padding:'5px 14px',fontSize: '14px',background:'#9b6fe811'}}>+ BOND</button>
                  </div>
                  {/* Stats */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'4px',marginBottom:'6px'}}>
                    {[['PWR',p.power,'#c8503a'],['AGI',p.agility,'#50a060'],['FOC',p.focus,'#9b6fe8'],['PRE',p.presence,'#c4922a']].map(([lbl,val,col])=>(
                      <div key={lbl} style={{textAlign:'center',background:T.bg,borderRadius:'3px',padding:'3px',border:`1px solid ${col}22`}}>
                        <div style={{fontFamily:"'Cinzel',serif",fontSize: '12px',color:T.textMuted}}>{lbl}</div>
                        <div style={{fontWeight:'700',color:col,fontSize: '16px'}}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{display:'flex',gap:'10px',fontSize: '15px',color:T.textMuted,marginBottom:p.attacks?.length?'6px':0}}>
                    <span>HP: <strong style={{color:T.hp}}>{String(p.max_hp)}</strong></span>
                    <span>RP: <strong style={{color:T.rp}}>{p.base_rp}</strong></span>
                    <span>MOV: <strong style={{color:T.text}}>{p.movement}ft</strong></span>
                  </div>
                  {p.attacks?.length>0&&(
                    <div style={{marginTop:'6px'}}>
                      {p.attacks.map(atk=>(
                        <div key={atk.id} style={{display:'flex',justifyContent:'space-between',fontSize: '14px',padding:'2px 0',borderBottom:`1px solid ${T.border}`}}>
                          <span style={{color:T.text}}>{atk.name}</span>
                          <span style={{color:'#9b6fe8'}}>{atk.damage_dice} <span style={{color:T.textMuted}}>{atk.damage_type}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.description&&<div style={{marginTop:'6px',fontSize: '15px',color:T.textMuted,lineHeight:'1.5'}}>{p.description}</div>}
                </div>
              ))
            }
            {!libPetLoading&&libPetItems.filter(p=>!libPetSearch||p.name.toLowerCase().includes(libPetSearch.toLowerCase())||p.species.toLowerCase().includes(libPetSearch.toLowerCase())).length===0&&(
              <div style={{padding:'24px',textAlign:'center',color:T.textDim,fontSize: '16px'}}>No companions found. Create one in the Homebrew Workshop.</div>
            )}
          </div>
          <button onClick={()=>setWepModal(null)} style={{...Btn(T.textMuted),padding:'9px',width:'100%',marginTop:'12px'}}>CLOSE</button>
        </ModalWrap>
      )}
    </div>
  );
}