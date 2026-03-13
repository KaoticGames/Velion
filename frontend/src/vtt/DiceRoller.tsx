/**
 * DiceRoller.tsx — 3D dice tray, anchored bottom-left next to toolbar
 *
 * Portal — always mounted, shown/hidden via opacity so WebGL canvas stays alive.
 *
 * Icons: MDI-style polyhedral shapes (polygon outline + die number).
 * When @mdi/js is available: replace DiceIcon with <path d={mdiDiceD4} />
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Action } from './useVTTState';
import type { DiceVisibility } from './types';

const T = {
  bg:        '#080b10',
  surface:   '#0d1018',
  card:      '#111520',
  border:    '#1c2230',
  gold:      '#c4922a',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  rp:        '#3ab5e8',
  hp:        '#d45c5c',
  green:     '#50a060',
};

const CDN = 'https://unpkg.com/@3d-dice/dice-box@1.0.8/dist/';

let _box: any  = null;
let _initing   = false;

const DICE: { type: string; label: string; sides: number }[] = [
  { type:'d4',   label:'D4',   sides:4   },
  { type:'d6',   label:'D6',   sides:6   },
  { type:'d8',   label:'D8',   sides:8   },
  { type:'d10',  label:'D10',  sides:10  },
  { type:'d12',  label:'D12',  sides:12  },
  { type:'d20',  label:'D20',  sides:20  },
  { type:'d100', label:'D%',   sides:100 },
];

type DiceType = 'd4'|'d6'|'d8'|'d10'|'d12'|'d20'|'d100';

const VIS_CFG: Record<DiceVisibility,{label:string;color:string}> = {
  public:  { label:'🌐 PUBLIC',  color:T.green },
  private: { label:'🔒 PRIVATE', color:T.rp   },
  dm:      { label:'👁 DM',      color:T.gold  },
};

const COLOR_PRESETS = [
  { label:'Gold',     hex:'#c4922a' },
  { label:'Crimson',  hex:'#c42a2a' },
  { label:'Sapphire', hex:'#2a5ec4' },
  { label:'Emerald',  hex:'#2ac45e' },
  { label:'Amethyst', hex:'#8a2ac4' },
  { label:'Onyx',     hex:'#222222' },
  { label:'Ivory',    hex:'#e8dfc4' },
  { label:'Arctic',   hex:'#7acce8' },
];

function summarise(dice: DiceType[]): string {
  const m = new Map<DiceType,number>();
  dice.forEach(d => m.set(d,(m.get(d)??0)+1));
  return [...m.entries()].map(([d,n])=>`${n}${d}`).join(' + ');
}

// ── Polyhedral dice icons ─────────────────────────────────────────────────
// MDI-style: proper polygon shapes with the die number inside.
// Replace with @mdi/js path imports once `npm install @mdi/js` is run.

function DiceIcon({ type, size=34, color='currentColor' }: { type:string; size?:number; color?:string }) {
  const numColor = color;
  const sw = 1.6;
  const fontProps = {
    textAnchor: 'middle' as const,
    fontFamily: "'Cinzel', Georgia, serif",
    fontWeight: 'bold' as const,
    fill: numColor,
    style: { userSelect: 'none' as const, pointerEvents: 'none' as const },
  };

  switch(type) {
    case 'd4': // tetrahedron — upward triangle, face lines to midpoints
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <polygon points="12,2 22,21 2,21" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round"/>
          {/* Interior face edges from centroid (12,14.7) to edge midpoints */}
          <line x1="12" y1="14.7" x2="7" y2="11.5" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="12" y1="14.7" x2="17" y2="11.5" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="12" y1="14.7" x2="12" y2="21" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <text x="12" y="20" fontSize="7.5" {...fontProps}>4</text>
        </svg>
      );
    case 'd6': // cube — isometric hexagon with 3 face-edges from centre
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>
          {/* Top 3 cube edges from center-top */}
          <line x1="12" y1="2" x2="12" y2="12" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="3"  y1="7" x2="12" y2="12" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="21" y1="7" x2="12" y2="12" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <text x="12" y="20" fontSize="8" {...fontProps}>6</text>
        </svg>
      );
    case 'd8': // octahedron — diamond with equatorial line
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <polygon points="12,2 22,12 12,22 2,12" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>
          <line x1="2" y1="12" x2="22" y2="12" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="12" y1="2" x2="2"  y2="12" stroke={color} strokeWidth={0.8} opacity={0}/>
          {/* Cross lines showing upper/lower face divide */}
          <line x1="12" y1="2"  x2="22" y2="12" stroke={color} strokeWidth={0.8} opacity={0.35}/>
          <line x1="12" y1="22" x2="22" y2="12" stroke={color} strokeWidth={0.8} opacity={0.35}/>
          <text x="12" y="17" fontSize="8" {...fontProps}>8</text>
        </svg>
      );
    case 'd10': // pentagonal trapezohedron — kite / pointed top & bottom
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          {/* Classic d10 outline: wide at shoulders, pointed top & flat bottom */}
          <polygon points="12,2 21,9.5 18.5,21 5.5,21 3,9.5" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>
          <line x1="3" y1="9.5" x2="21" y2="9.5" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="12" y1="2"  x2="3"  y2="9.5" stroke={color} strokeWidth={0.8} opacity={0.35}/>
          <line x1="12" y1="2"  x2="21" y2="9.5" stroke={color} strokeWidth={0.8} opacity={0.35}/>
          <text x="12" y="19.5" fontSize="7" {...fontProps}>10</text>
        </svg>
      );
    case 'd12': // dodecahedron — pentagon
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          {/* Regular pentagon, point at top */}
          <polygon points="12,2 21.5,8.7 17.8,20.5 6.2,20.5 2.5,8.7" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>
          {/* Inner pentagon lines */}
          <line x1="12"  y1="2"    x2="17.8" y2="20.5" stroke={color} strokeWidth={0.8} opacity={0.35}/>
          <line x1="12"  y1="2"    x2="6.2"  y2="20.5" stroke={color} strokeWidth={0.8} opacity={0.35}/>
          <text x="12" y="18.5" fontSize="7" {...fontProps}>12</text>
        </svg>
      );
    case 'd20': // icosahedron — hexagonal with triangulated internal faces
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          {/* Outer hexagonal outline */}
          <polygon points="12,2 20.5,6.5 20.5,17.5 12,22 3.5,17.5 3.5,6.5" stroke={color} strokeWidth={sw} strokeLinejoin="round"/>
          {/* Upper and lower edge bands */}
          <line x1="3.5"  y1="6.5"  x2="20.5" y2="6.5"  stroke={color} strokeWidth={0.8} opacity={0.55}/>
          <line x1="3.5"  y1="17.5" x2="20.5" y2="17.5" stroke={color} strokeWidth={0.8} opacity={0.55}/>
          {/* Triangulation lines */}
          <line x1="12"  y1="2"    x2="3.5"  y2="17.5" stroke={color} strokeWidth={0.8} opacity={0.3}/>
          <line x1="12"  y1="2"    x2="20.5" y2="17.5" stroke={color} strokeWidth={0.8} opacity={0.3}/>
          <text x="12" y="16" fontSize="7" {...fontProps}>20</text>
        </svg>
      );
    case 'd100': // two overlapping circles = percentile pair
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <circle cx="9"  cy="12" r="7.5" stroke={color} strokeWidth={sw}/>
          <circle cx="16" cy="12" r="5"   stroke={color} strokeWidth={1} opacity={0.55}/>
          <text x="9" y="16" fontSize="8.5" {...fontProps}>%</text>
        </svg>
      );
    default: return null;
  }
}

// ── Toolbar dice button ───────────────────────────────────────────────────

export function DiceToolbarButton({ open, onClick }: { open:boolean; onClick:()=>void }) {
  return (
    <div style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', marginBottom:'6px' }}>
      <span style={{ fontFamily:"'Cinzel',serif", fontSize:'7px', letterSpacing:'0.16em', color:T.textDim }}>DICE</span>
      <button onClick={onClick} title="Dice tray"
        style={{ width:'40px', height:'40px', display:'flex', alignItems:'center', justifyContent:'center', background: open ? T.gold+'22' : 'transparent', border:`1px solid ${open ? T.gold : T.border}`, borderRadius:'4px', cursor:'pointer', fontSize:'18px', color: open ? T.gold : T.textMuted, transition:'all 0.12s' }}>
        🎲
      </button>
    </div>
  );
}

// ── Portal ────────────────────────────────────────────────────────────────

interface PortalProps {
  open:         boolean;
  toolbarWidth: number;
  sessionId:    string;
  visibility:   DiceVisibility;
  isDM:         boolean;
  socket: { rollDice: (p:{formula:string;label:string;visibility:DiceVisibility;results:number[];total:number})=>void };
  onClose:      ()=>void;
  dispatch:     (action:Action)=>void;
}

export default function DiceRollerPortal(props: PortalProps) {
  const { open, toolbarWidth, visibility, isDM, socket, onClose } = props;

  const [pending,      setPending]      = useState<DiceType[]>([]);
  const [rolling,      setRolling]      = useState(false);
  const [lastResults,  setLastResults]  = useState<{die:DiceType;value:number}[]>([]);
  const [label,        setLabel]        = useState('');
  const [vis,          setVis]          = useState<DiceVisibility>(visibility);
  const [status,       setStatus]       = useState<'loading'|'ready'|'error'>('loading');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [diceColor,    setDiceColor]    = useState('#c4922a');
  const [customColor,  setCustomColor]  = useState('#c4922a');

  const pendingRef = useRef<DiceType[]>([]);
  const labelRef   = useRef('');
  const visRef     = useRef<DiceVisibility>(visibility);
  useEffect(()=>{ pendingRef.current=pending; },[pending]);
  useEffect(()=>{ labelRef.current=label;     },[label]);
  useEffect(()=>{ visRef.current=vis;         },[vis]);

  const applyColor = (hex: string) => {
    setDiceColor(hex);
    if (_box) _box.updateConfig({ themeColor: hex });
  };

  const onRollComplete = (results: any[]) => {
    const valid = results.filter((r:any)=>r.value>0);
    const d10Results        = valid.filter((r:any)=>r.sides===10);
    const percentileResults = valid.filter((r:any)=>r.sides===100);
    const otherResults      = valid.filter((r:any)=>r.sides!==10&&r.sides!==100);
    const d100Count: number = (_box?._d100Count??0) as number;
    if (_box) _box._d100Count=0;

    const mapped: {die:DiceType;value:number}[] = [];
    for (let i=0; i<d100Count; i++) {
      const pct   = percentileResults.shift();
      const units = d10Results.shift();
      if (pct!==undefined && units!==undefined) {
        const t = pct.value, u = units.value;
        mapped.push({ die:'d100', value: t===0&&u===10 ? 100 : t+(u===10?0:u) });
      }
    }
    d10Results.forEach((r:any)=>mapped.push({die:'d10',value:r.value}));
    otherResults.forEach((r:any)=>mapped.push({die:`d${r.sides}` as DiceType,value:r.value}));

    setLastResults(mapped);
    setRolling(false);
    // ↓ Clear pending IMMEDIATELY so highlights reset after roll
    setPending([]);

    const values  = mapped.map(r=>r.value);
    const total   = values.reduce((s,n)=>s+n,0);
    const formula = summarise(pendingRef.current.length>0 ? pendingRef.current : mapped.map(r=>r.die));
    socket.rollDice({ formula, label: labelRef.current||formula, visibility: visRef.current, results: values, total });
    setLabel('');
  };

  useEffect(()=>{
    if (!open) return;
    if (_box) {
      const existingCanvas = document.getElementById('dice-tray-canvas-host')?.querySelector('canvas');
      if (existingCanvas && document.body.contains(existingCanvas)) {
        _box.onRollComplete = onRollComplete;
        setStatus('ready');
        return;
      }
      if (typeof _box._velionResizeCleanup==='function') _box._velionResizeCleanup();
      _box=null; _initing=false;
    }
    if (_initing) return;
    _initing=true;

    (async()=>{
      try {
        const {default:DiceBox} = await import(/* @vite-ignore */ `${CDN}dice-box.es.min.js`);
        const el = document.getElementById('dice-tray-canvas-host');
        if (!el) throw new Error('#dice-tray-canvas-host not found');
        if (el.offsetWidth===0) {
          await new Promise<void>(res=>{ const ro=new ResizeObserver((_,o)=>{if(el.offsetWidth>0){o.disconnect();res();}}); ro.observe(el); });
        }
        const W=el.offsetWidth, H=el.offsetHeight;

        const box = new DiceBox('#dice-tray-canvas-host',{
          assetPath:'assets/', origin:CDN, theme:'default',
          offscreen:false, width:W, height:H, scale:7,
          gravity:1, mass:1, friction:0.8, restitution:0.5,
          angularDamping:0.4, linearDamping:0.4,
          spinForce:6, throwForce:4, startingHeight:10,
          settleTimeout:5000, themeColor:diceColor,
        });
        box.onRollComplete = onRollComplete;
        await box.init();

        const canvas = el.querySelector('canvas') as HTMLCanvasElement|null;
        if (canvas) {
          canvas.width=W; canvas.height=H;
          canvas.style.cssText='position:absolute;top:0;left:0;width:'+W+'px;height:'+H+'px;z-index:0;';
          window.dispatchEvent(new Event('resize'));
        }

        box._velionResizeCleanup = ()=>{};
        _box=box; _initing=false;
        setStatus('ready');
      } catch(e:any) {
        _initing=false;
        setStatus('error');
        setErrorMsg(e?.message??String(e));
      }
    })();
  },[open]);

  const roll = ()=>{
    if (!_box||pending.length===0||rolling) return;
    setRolling(true); setLastResults([]);
    const d100Count = pending.filter(d=>d==='d100').length;
    const counts = new Map<number,number>();
    pending.forEach(d=>{ if(d==='d100') return; const s=parseInt(d.slice(1)); counts.set(s,(counts.get(s)??0)+1); });
    _box._d100Count=d100Count;
    if (d100Count>0) { counts.set(100,(counts.get(100)??0)+d100Count); counts.set(10,(counts.get(10)??0)+d100Count); }
    _box.roll([...counts.entries()].map(([sides,qty])=>({qty,sides})));
  };

  const clear = ()=>{ setPending([]); setLastResults([]); _box?.clear(); };
  const total = lastResults.reduce((s,r)=>s+r.value,0);

  const TRAY_W   = 380;
  const CANVAS_H = 260;
  const TRAY_BOTTOM = 16; // ↑ lifted off the floor for a definitive bottom edge

  return createPortal(
    <>
      {/* Inject hover CSS — avoids inline handler state-sync bugs */}
      <style>{`
        .vm-dice-btn:not(:disabled):hover {
          border-color: ${T.gold} !important;
          background: ${T.gold}10 !important;
        }
        .vm-dice-btn:not(:disabled):hover svg * {
          stroke: ${T.gold};
          fill: ${T.gold};
        }
      `}</style>

      <div style={{
        position:'fixed', bottom:TRAY_BOTTOM+'px', left:toolbarWidth+'px', zIndex:300,
        width:TRAY_W+'px',
        background:T.card,
        border:`1px solid ${T.border}`,
        borderRadius:'6px',               // all corners rounded — definitive floating window
        boxShadow:'0 8px 32px rgba(0,0,0,0.75), 0 2px 8px rgba(0,0,0,0.5)',
        display:'flex', flexDirection:'column',
        opacity: open?1:0, pointerEvents: open?'auto':'none',
        transition:'opacity 0.15s',
        overflow:'hidden',                // clip children to rounded corners
      }}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 12px',borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontFamily:"'Cinzel',serif",fontSize:'10px',letterSpacing:'0.18em',color:T.text}}>DICE TRAY</span>
            <span style={{fontSize:'8px',color:status==='ready'?T.green:status==='error'?T.hp:T.textDim}}>
              {status==='ready'?'3D ●':status==='error'?'ERR ●':'LOADING…'}
            </span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
            <button onClick={()=>setShowSettings(s=>!s)} title="Dice appearance"
              style={{display:'flex',alignItems:'center',gap:'5px',background:'transparent',border:`1px solid ${showSettings?T.gold:T.border}`,borderRadius:'3px',padding:'3px 8px',cursor:'pointer',color:showSettings?T.gold:T.textMuted,fontFamily:"'Cinzel',serif",fontSize:'8px',letterSpacing:'0.1em',transition:'all 0.12s'}}>
              <div style={{width:'10px',height:'10px',borderRadius:'50%',background:diceColor,flexShrink:0}}/>
              APPEARANCE
            </button>
            <button onClick={onClose} style={{background:'transparent',border:'none',cursor:'pointer',color:T.textMuted,fontSize:'16px',lineHeight:1}}>×</button>
          </div>
        </div>

        {/* Appearance panel */}
        {showSettings && (
          <div style={{padding:'10px 12px',background:T.bg,borderBottom:`1px solid ${T.border}`,flexShrink:0}}>
            <div style={{fontFamily:"'Cinzel',serif",fontSize:'8px',letterSpacing:'0.14em',color:T.textDim,marginBottom:'8px'}}>DICE COLOR</div>
            <div style={{display:'flex',gap:'6px',flexWrap:'wrap',alignItems:'center'}}>
              {COLOR_PRESETS.map(p=>(
                <button key={p.hex} onClick={()=>applyColor(p.hex)} title={p.label}
                  style={{width:'22px',height:'22px',borderRadius:'3px',cursor:'pointer',background:p.hex,border:`2px solid ${diceColor===p.hex?'#fff':'transparent'}`,padding:0,flexShrink:0}}/>
              ))}
              <label style={{width:'22px',height:'22px',borderRadius:'3px',cursor:'pointer',overflow:'hidden',border:`1px solid ${T.border}`,flexShrink:0,position:'relative'}} title="Custom color">
                <input type="color" value={customColor}
                  onChange={e=>setCustomColor(e.target.value)}
                  onBlur={e=>applyColor(e.target.value)}
                  style={{position:'absolute',top:'-4px',left:'-4px',width:'30px',height:'30px',border:'none',cursor:'pointer'}}/>
              </label>
            </div>
            <div style={{marginTop:'8px',fontSize:'9px',color:T.textDim,lineHeight:'1.5'}}>
              For Rust, Gemstone & other theme styles: <code style={{color:T.textMuted}}>npm install @3d-dice/dice-themes</code> (requires local assets).
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{padding:'6px 12px',background:T.hp+'18',borderBottom:`1px solid ${T.border}`,fontSize:'9px',color:T.hp,wordBreak:'break-all'}}>{errorMsg}</div>
        )}

        {/* Body: dice column + canvas */}
        <div style={{display:'flex',flex:1,flexShrink:0}}>

          {/* Vertical dice selector — CSS hover via injected style, NOT inline handlers */}
          <div style={{width:'52px',background:T.surface,borderRight:`1px solid ${T.border}`,display:'flex',flexDirection:'column',alignItems:'center',padding:'6px 0',gap:'3px',flexShrink:0}}>
            {DICE.map(d=>{
              const count   = pending.filter(p=>p===d.type).length;
              const active  = count > 0;
              const disabled= rolling || status!=='ready';
              return (
                <button key={d.type}
                  className="vm-dice-btn"
                  onClick={()=>{ if(!disabled) setPending(p=>[...p,d.type as DiceType]); }}
                  disabled={disabled}
                  title={`${d.label}${count>0?' (×'+count+')':''}`}
                  style={{
                    position:'relative',
                    width:'42px', height:'42px',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    background: active ? T.gold+'1a' : 'transparent',
                    border:`1px solid ${active ? T.gold : T.border}`,
                    borderRadius:'4px',
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    padding:0,
                    transition:'all 0.1s',
                    opacity: disabled ? 0.4 : 1,
                  }}>
                  <DiceIcon type={d.type} size={30} color={active ? T.gold : T.textMuted}/>
                  {count > 0 && (
                    <span style={{position:'absolute',top:'1px',right:'3px',fontSize:'8px',color:T.gold,fontWeight:700,lineHeight:1}}>{count}</span>
                  )}
                </button>
              );
            })}

            {/* Clear */}
            <div style={{width:'30px',height:'1px',background:T.border,margin:'3px 0'}}/>
            <button className="vm-dice-btn" onClick={clear} disabled={rolling} title="Clear dice"
              style={{width:'42px',height:'28px',display:'flex',alignItems:'center',justifyContent:'center',background:'transparent',border:`1px solid ${T.border}`,borderRadius:'4px',cursor:'pointer',color:T.textMuted,fontSize:'12px',opacity:rolling?0.4:1,transition:'all 0.1s'}}>
              ✕
            </button>
          </div>

          {/* Canvas + controls */}
          <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0}}>

            {/* 3D canvas */}
            <div id="dice-tray-canvas-host"
              style={{width:'100%',height:CANVAS_H+'px',minHeight:CANVAS_H+'px',flexShrink:0,position:'relative',background:T.bg,overflow:'hidden'}}>
              {status==='loading' && (
                <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:'8px',zIndex:2}}>
                  <div style={{width:'20px',height:'20px',border:`2px solid ${T.border}`,borderTop:`2px solid ${T.gold}`,borderRadius:'50%',animation:'vm-spin 0.8s linear infinite'}}/>
                  <span style={{fontFamily:"'Cinzel',serif",fontSize:'8px',letterSpacing:'0.16em',color:T.textDim}}>LOADING…</span>
                  <style>{`@keyframes vm-spin{to{transform:rotate(360deg)}}`}</style>
                </div>
              )}
              {lastResults.length>0 && (
                <div style={{position:'absolute',bottom:'6px',left:0,right:0,display:'flex',justifyContent:'center',gap:'4px',flexWrap:'wrap',pointerEvents:'none',zIndex:2}}>
                  {lastResults.map((r,i)=>(
                    <div key={i} style={{width:'32px',height:'32px',display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(8,11,16,0.85)',border:`1px solid ${T.gold}`,borderRadius:'3px',fontFamily:"'Cinzel',serif",fontSize:'14px',fontWeight:700,color:T.gold}}>
                      {r.value}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Controls */}
            <div style={{padding:'8px 10px',display:'flex',flexDirection:'column',gap:'6px',borderTop:`1px solid ${T.border}`}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',minHeight:'18px'}}>
                <span style={{fontSize:'10px',color:T.textMuted}}>{pending.length>0?summarise(pending):'\u00a0'}</span>
                {lastResults.length>0 && (
                  <span style={{fontFamily:"'Cinzel',serif",fontSize:'10px',color:T.textDim}}>
                    TOTAL <span style={{fontSize:'18px',fontWeight:700,color:T.gold}}>{total}</span>
                  </span>
                )}
              </div>

              <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Label (optional)"
                style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:'2px',padding:'5px 8px',color:T.text,fontSize:'10px',outline:'none',width:'100%',boxSizing:'border-box'}}/>

              <div style={{display:'flex',gap:'4px'}}>
                {(Object.keys(VIS_CFG) as DiceVisibility[]).filter(v=>isDM||v!=='dm').map(v=>{
                  const cfg=VIS_CFG[v];
                  return (
                    <button key={v} onClick={()=>setVis(v)}
                      style={{flex:1,padding:'4px 0',borderRadius:'2px',cursor:'pointer',fontFamily:"'Cinzel',serif",fontSize:'7px',letterSpacing:'0.1em',background:vis===v?cfg.color+'22':'transparent',border:`1px solid ${vis===v?cfg.color:T.border}`,color:vis===v?cfg.color:T.textDim}}>
                      {cfg.label}
                    </button>
                  );
                })}
                <button onClick={roll} disabled={pending.length===0||rolling||status!=='ready'}
                  style={{flex:2,padding:'4px 8px',borderRadius:'2px',cursor:pending.length>0&&!rolling&&status==='ready'?'pointer':'not-allowed',fontFamily:"'Cinzel',serif",fontSize:'9px',letterSpacing:'0.14em',background:pending.length>0&&!rolling&&status==='ready'?T.gold+'22':'transparent',border:`1px solid ${pending.length>0&&!rolling&&status==='ready'?T.gold:T.border}`,color:pending.length>0&&!rolling&&status==='ready'?T.gold:T.textDim}}>
                  {rolling?'ROLLING…':'ROLL'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}