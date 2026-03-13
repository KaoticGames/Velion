/**
 * DMToolbar.tsx — Left-side DM tool palette
 */

import React, { useState, useRef } from 'react';
import { DiceToolbarButton }        from './DiceRoller';
import { useQuery }         from '@tanstack/react-query';
import { api }              from '@/lib/api';
import type { Action }      from './useVTTState';
import type { ToolMode, FogBrushShape, VTTMap, EnemyStatBlock, EnemyInstance, MapToken } from './types';

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

interface Props {
  activeTool:    ToolMode;
  toolColor:     string;
  fogBrushSize:  number;
  fogBrushShape: FogBrushShape;
  fogSections:   import('./types').FogSection[];
  campaignMaps:  VTTMap[];
  activeMapId:   string | null;
  sessionId:     string;
  campaignId:    string;
  showDiceTray:  boolean;
  onToggleDiceTray: () => void;
  socket: {
    changeMap:            (id: string) => void;
    rollAttack:           (p: any) => void;
    broadcastTokenPlaced: (t: unknown) => void;
  };
  dispatch: (action: Action) => void;
}

const TOOL_GROUPS = [
  { label:'MOVE',    tools:[
    { id:'select',      icon:'↖',  title:'Select & move assets  (click again to pan viewport)' },
  ]},
  { label:'FOG',     tools:[
    { id:'fog_reveal',  icon:'👁',  title:'Reveal fog' },
    { id:'fog_hide',    icon:'🌑',  title:'Hide fog' },
    { id:'fog_section', icon:'⬡',   title:'Paint fog section' },
  ]},
  { label:'MEASURE', tools:[{ id:'ruler',       icon:'📏', title:'Ruler (uses feet per cell)' }] },
  { label:'DRAW',    tools:[{ id:'marker', icon:'📍', title:'Marker' }, { id:'circle', icon:'⭕', title:'Circle AoE' }, { id:'rect', icon:'⬜', title:'Rectangle' }, { id:'line', icon:'╱', title:'Line' }, { id:'cone', icon:'◬', title:'Cone 60°' }] },
  { label:'TOKENS',  tools:[{ id:'token_place', icon:'🪙', title:'Place token' }] },
];

const COLORS = ['#ff4444','#ff9933','#ffdd00','#44cc44','#3ab5e8','#aa55ff','#ffffff','#888888'];

export default function DMToolbar(props: Props) {
  const { activeTool, toolColor, fogBrushSize, fogBrushShape, fogSections, campaignMaps, activeMapId, sessionId, campaignId, showDiceTray, onToggleDiceTray, socket, dispatch } = props;
  const [showMapModal,   setShowMapModal]   = useState(false);
  const [showTokenModal, setShowTokenModal] = useState(false);

  const setTool       = (tool: ToolMode)       => dispatch({ type: 'SET_TOOL', tool });
  const setColor      = (color: string)        => dispatch({ type: 'SET_TOOL_COLOR', color });
  const setBrush      = (size: number)         => dispatch({ type: 'SET_FOG_BRUSH_SIZE', size });
  const setBrushShape = (shape: FogBrushShape) => dispatch({ type: 'SET_FOG_BRUSH_SHAPE', shape });

  const isFogTool  = activeTool === 'fog_reveal' || activeTool === 'fog_hide' || activeTool === 'fog_section';
  const isDrawTool = ['marker','circle','rect','line','cone'].includes(activeTool);
  const isPanMode  = activeTool === 'pan';

  return (
    <>
      <div style={{ width:'56px', display:'flex', flexDirection:'column', alignItems:'center', background:T.surface, borderRight:`1px solid ${T.border}`, padding:'8px 0', gap:'4px', flexShrink:0, overflowY:'auto' }}>
        {TOOL_GROUPS.map(group => (
          <div key={group.label} style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', marginBottom:'6px' }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'7px', letterSpacing:'0.16em', color:T.textDim, marginBottom:'2px' }}>{group.label}</span>
            {group.tools.map(tool => {
              // 'select' button represents both select and pan modes
              const isSelectBtn = tool.id === 'select';
              const active = isSelectBtn ? (activeTool === 'select' || activeTool === 'pan') : activeTool === tool.id;
              const displayIcon = isSelectBtn && isPanMode ? '✋' : tool.icon;
              return (
                <button key={tool.id} title={isSelectBtn && isPanMode ? 'Pan viewport (click to switch back to select)' : tool.title}
                  onClick={() => {
                    if (tool.id === 'token_place') { setShowTokenModal(true); return; }
                    // Toggle select↔pan for the move button
                    if (isSelectBtn) {
                      setTool(activeTool === 'select' ? 'pan' : 'select');
                    } else {
                      setTool(tool.id as ToolMode);
                    }
                  }}
                  style={{ width:'40px', height:'40px', display:'flex', alignItems:'center', justifyContent:'center', background: active ? T.gold+'22' : 'transparent', border:`1px solid ${active ? T.gold : T.border}`, borderRadius:'4px', cursor:'pointer', fontSize:'16px', color: active ? T.gold : T.textMuted, transition:'all 0.12s', position:'relative' }}
                >
                  {displayIcon}
                  {isSelectBtn && isPanMode && (
                    <span style={{ position:'absolute', bottom:'1px', right:'2px', fontSize:'6px', color:T.gold, fontFamily:"'Cinzel',serif" }}>PAN</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        <div style={{ width:'32px', height:'1px', background:T.border, margin:'4px 0' }} />

        {isDrawTool && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'3px', marginBottom:'6px' }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'7px', letterSpacing:'0.14em', color:T.textDim }}>COLOR</span>
            {COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)} style={{ width:'22px', height:'22px', borderRadius:'3px', cursor:'pointer', background:c, border:`2px solid ${toolColor===c ? '#fff' : 'transparent'}`, padding:0 }} />
            ))}
            <label style={{ width:'22px', height:'22px', borderRadius:'3px', cursor:'pointer', overflow:'hidden', border:`1px solid ${T.border}` }}>
              <input type="color" value={toolColor} onChange={e => setColor(e.target.value)} style={{ width:'100%', height:'100%', border:'none', padding:0, cursor:'pointer' }} />
            </label>
          </div>
        )}

        {(activeTool === 'fog_reveal' || activeTool === 'fog_hide') && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'3px', marginBottom:'6px' }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'7px', letterSpacing:'0.14em', color:T.textDim }}>BRUSH</span>
            <div style={{ display:'flex', gap:'2px', marginBottom:'2px' }}>
              {([['○','circle'],['□','square'],['⊕','fill']] as [string,FogBrushShape][]).map(([icon, shape]) => (
                <button key={shape} onClick={() => setBrushShape(shape)} title={shape==='fill'?'Flood fill':shape}
                  style={{ width:'18px', height:'18px', display:'flex', alignItems:'center', justifyContent:'center', background: fogBrushShape===shape ? T.rp+'22' : 'transparent', border:`1px solid ${fogBrushShape===shape ? T.rp : T.border}`, borderRadius:'2px', cursor:'pointer', color: fogBrushShape===shape ? T.rp : T.textMuted, fontSize:'11px' }}>
                  {icon}
                </button>
              ))}
            </div>
            {fogBrushShape !== 'fill' && [0,1,2,3].map(size => (
              <button key={size} onClick={() => setBrush(size)} title={size===0 ? '1 cell' : `${size*2+1}×${size*2+1}`}
                style={{ width:'36px', height:'26px', display:'flex', alignItems:'center', justifyContent:'center', background: fogBrushSize===size ? T.rp+'22' : 'transparent', border:`1px solid ${fogBrushSize===size ? T.rp : T.border}`, borderRadius:'3px', cursor:'pointer', color: fogBrushSize===size ? T.rp : T.textMuted, fontFamily:"'Cinzel',serif", fontSize:'8px' }}>
                {size===0 ? '1' : `${size*2+1}²`}
              </button>
            ))}
          </div>
        )}

        <div style={{ flex:1 }} />

        <div style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', padding:'0 0 8px' }}>
          <DiceToolbarButton open={showDiceTray} onClick={onToggleDiceTray} />
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:'7px', letterSpacing:'0.16em', color:T.textDim }}>MAPS</span>
          <button onClick={() => setShowMapModal(true)} title="Manage maps"
            style={{ width:'40px', height:'40px', display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:`1px solid ${T.border}`, borderRadius:'4px', cursor:'pointer', fontSize:'18px' }}
          >🗺</button>
        </div>
      </div>

      {showMapModal   && <MapModal   campaignId={campaignId} campaignMaps={campaignMaps} activeMapId={activeMapId} sessionId={sessionId} fogSections={fogSections} activeTool={activeTool} socket={socket} dispatch={dispatch} onClose={() => setShowMapModal(false)} />}
      {showTokenModal && <TokenPlaceModal sessionId={sessionId} socket={socket} dispatch={dispatch} onClose={() => { setShowTokenModal(false); setTool('select'); }} />}
    </>
  );
}

// ── Map Modal ──────────────────────────────────────────────────────────────

function MapModal({ campaignId, campaignMaps, activeMapId, sessionId, fogSections, activeTool, socket, dispatch, onClose }: {
  campaignId:   string;
  campaignMaps: VTTMap[];
  activeMapId:  string | null;
  sessionId:    string;
  fogSections:  import('./types').FogSection[];
  activeTool:   ToolMode;
  socket:       { changeMap: (id: string) => void };
  dispatch:     (action: Action) => void;
  onClose:      () => void;
}) {
  const [tab,          setTab]          = useState<'maps'|'upload'|'edit'|'sections'>('maps');
  const [mapName,      setMapName]      = useState('');
  const [gridSize,     setGridSize]     = useState(70);
  const [feetPerCell,  setFeetPerCell]  = useState(5);
  const [file,         setFile]         = useState<File | null>(null);
  const [preview,   setPreview]   = useState<string | null>(null);
  const [imgDims,   setImgDims]   = useState<{ w: number; h: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState<string>('');
  const [error,     setError]     = useState('');
  // Edit map state
  const [editName,        setEditName]        = useState('');
  const [editGridSize,    setEditGridSize]     = useState(70);
  const [editFeetPerCell, setEditFeetPerCell]  = useState(5);
  const [editWidthCells,  setEditWidthCells]   = useState(20);
  const [editHeightCells, setEditHeightCells]  = useState(20);
  const [editSaving,      setEditSaving]       = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: mapsData, refetch } = useQuery({
    queryKey: ['campaign-maps', campaignId],
    queryFn:  () => api.get(`/vtt/campaigns/${campaignId}/maps`).then(r => r.data?.data ?? []),
    initialData: campaignMaps,
  });
  const maps: VTTMap[] = mapsData ?? [];
  const activeMap = maps.find(m => m.id === activeMapId) ?? null;

  // Populate edit fields when switching to edit tab
  const openEdit = () => {
    if (!activeMap) return;
    setEditName(activeMap.name);
    setEditGridSize(activeMap.grid_cell_size);
    setEditFeetPerCell(activeMap.feet_per_cell ?? 5);
    setEditWidthCells(activeMap.width_cells);
    setEditHeightCells(activeMap.height_cells);
    setTab('edit');
  };

  const saveEdit = async () => {
    if (!activeMap) return;
    setEditSaving(true); setError('');
    try {
      const { data: updated } = await api.patch(`/vtt/campaigns/${campaignId}/maps/${activeMap.id}`, {
        name:           editName.trim() || activeMap.name,
        grid_cell_size: editGridSize,
        feet_per_cell:  editFeetPerCell,
        width_cells:    editWidthCells,
        height_cells:   editHeightCells,
      });
      await refetch();
      dispatch({ type: 'MAP_CHANGED', map: updated, tokens: [], shapes: [], fogCells: [], fogSections: [] });
      setTab('maps');
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Save failed.');
    }
    setEditSaving(false);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setError('');
    setImgDims(null);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
      // Auto-compute grid cell count from image natural dimensions
      const img = new Image();
      img.onload = () => {
        setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    } else {
      setPreview(null);
    }
  };

  const uploadMap = async () => {
    if (!file || !mapName.trim()) { setError('Map name and image file are required.'); return; }
    setUploading(true); setError('');
    try {
      const width_cells  = imgDims ? Math.ceil(imgDims.w / gridSize) : 20;
      const height_cells = imgDims ? Math.ceil(imgDims.h / gridSize) : 20;

      // Step 1: get presigned URL
      setProgress('Preparing upload…');
      const { data: urlData } = await api.post(`/vtt/campaigns/${campaignId}/maps/upload-url`, {
        filename:     file.name,
        content_type: file.type || 'image/jpeg',
      });

      // Step 2: upload directly to R2
      setProgress('Uploading image…');
      await fetch(urlData.upload_url, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type || 'image/jpeg' },
      });

      // Step 3: register map in DB
      setProgress('Saving map…');
      const { data: map } = await api.post(`/vtt/campaigns/${campaignId}/maps`, {
        name:           mapName.trim(),
        image_url:      urlData.public_url,
        grid_cell_size: gridSize,
        feet_per_cell:  feetPerCell,
        width_cells,
        height_cells,
      });

      await refetch();
      dispatch({ type: 'MAP_CHANGED', map, tokens: [], shapes: [], fogCells: [], fogSections: [] });
      setTab('maps');
      setMapName(''); setFile(null); setPreview(null); setImgDims(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e: any) {
      setError(e?.response?.data?.error?.message ?? 'Upload failed. Please try again.');
    }
    setUploading(false); setProgress('');
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={onClose}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px', width:'500px', maxWidth:'92vw', maxHeight:'82vh', display:'flex', flexDirection:'column', overflow:'hidden' }} onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 20px', borderBottom:`1px solid ${T.border}` }}>
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:'13px', letterSpacing:'0.14em', color:T.text }}>MAP MANAGER</span>
          <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize:'18px', lineHeight:1 }}>×</button>
        </div>

        <div style={{ display:'flex', borderBottom:`1px solid ${T.border}` }}>
          {([['maps','MY MAPS'],['upload','UPLOAD'],['edit','EDIT MAP'],['sections','FOG SECTIONS']] as const).map(([t, label]) => (
            <button key={t} onClick={() => t === 'edit' ? openEdit() : setTab(t)}
              disabled={t === 'edit' && !activeMapId}
              style={{ flex:1, padding:'10px', background:'transparent', border:'none', borderBottom: tab===t ? `2px solid ${T.gold}` : '2px solid transparent', cursor: (t === 'edit' && !activeMapId) ? 'not-allowed' : 'pointer', fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.16em', color: tab===t ? T.gold : (t === 'edit' && !activeMapId) ? T.textDim : T.textMuted }}
            >{label}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
          {tab === 'maps' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {maps.length === 0 && (
                <div style={{ textAlign:'center', padding:'28px 0', color:T.textDim, fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.14em' }}>
                  NO MAPS YET — UPLOAD ONE TO GET STARTED
                </div>
              )}
              {maps.map(m => (
                <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'12px', background:T.surface, border:`1px solid ${m.id===activeMapId ? T.gold+'55' : T.border}`, borderRadius:'4px', padding:'10px 14px' }}>
                  {/* Thumbnail */}
                  <div style={{ width:'48px', height:'36px', borderRadius:'3px', background:T.bg, border:`1px solid ${T.border}`, overflow:'hidden', flexShrink:0 }}>
                    <img src={m.image_url} alt={m.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize:'12px', color: m.id===activeMapId ? T.gold : T.text, letterSpacing:'0.1em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {m.id===activeMapId && '▶ '}{m.name}
                    </div>
                    <div style={{ fontSize:'10px', color:T.textDim, marginTop:'2px' }}>{m.width_cells}×{m.height_cells} cells · {m.grid_cell_size}px grid</div>
                  </div>
                  <button onClick={() => { socket.changeMap(m.id); onClose(); }}
                    disabled={m.id===activeMapId}
                    style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.12em', padding:'5px 12px', borderRadius:'2px', cursor: m.id===activeMapId ? 'default' : 'pointer', background: m.id===activeMapId ? 'transparent' : T.gold+'18', border:`1px solid ${m.id===activeMapId ? T.border : T.gold}`, color: m.id===activeMapId ? T.textDim : T.gold, flexShrink:0 }}
                  >{m.id===activeMapId ? 'ACTIVE' : 'SET ACTIVE'}</button>
                </div>
              ))}
            </div>
          )}

          {tab === 'upload' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <FieldLabel label="MAP NAME">
                <input value={mapName} onChange={e => setMapName(e.target.value)} placeholder="e.g. Dungeon Level 1" style={inputSt} />
              </FieldLabel>

              <FieldLabel label="MAP IMAGE">
                <div
                  onClick={() => fileRef.current?.click()}
                  style={{ width:'100%', minHeight:'120px', background:T.surface, border:`2px dashed ${file ? T.gold+'66' : T.border}`, borderRadius:'4px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', overflow:'hidden', position:'relative' }}
                >
                  {preview ? (
                    <img src={preview} alt="preview" style={{ maxWidth:'100%', maxHeight:'180px', objectFit:'contain' }} />
                  ) : (
                    <div style={{ textAlign:'center', padding:'20px' }}>
                      <div style={{ fontSize:'28px', marginBottom:'8px' }}>🗺</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.14em', color:T.textMuted }}>CLICK TO SELECT IMAGE</div>
                      <div style={{ fontSize:'10px', color:T.textDim, marginTop:'4px' }}>JPG, PNG, WebP accepted</div>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} style={{ display:'none' }} />
                </div>
                {file && <div style={{ fontSize:'10px', color:T.textMuted, marginTop:'4px' }}>{file.name} ({(file.size/1024/1024).toFixed(1)} MB)</div>}
              </FieldLabel>

              <FieldLabel label="DISPLAY SIZE (px)">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={gridSize} onChange={e => setGridSize(parseInt(e.target.value)||70)} min={20} max={200}
                    style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize:'10px', color:T.textDim }}>pixels per square at 100% zoom</span>
                </div>
                {imgDims && (
                  <div style={{ fontSize:'10px', color:T.green, marginTop:'4px' }}>
                    ↳ Image {imgDims.w}×{imgDims.h}px → {Math.ceil(imgDims.w/gridSize)}×{Math.ceil(imgDims.h/gridSize)} grid cells
                  </div>
                )}
              </FieldLabel>

              <FieldLabel label="FEET PER SQUARE">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={feetPerCell} onChange={e => setFeetPerCell(parseInt(e.target.value)||5)} min={1} max={500}
                    style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize:'10px', color:T.textDim }}>ft — ruler + AoE tools use this</span>
                </div>
              </FieldLabel>

              {progress && <div style={{ fontSize:'11px', color:T.rp, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>{progress}</div>}
              {error    && <div style={{ fontSize:'11px', color:T.hp }}>{error}</div>}

              <button onClick={uploadMap} disabled={uploading || !file || !mapName.trim()}
                style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.14em', padding:'11px', borderRadius:'3px', cursor: uploading || !file || !mapName.trim() ? 'not-allowed' : 'pointer', background: !uploading && file && mapName.trim() ? T.gold+'22' : 'transparent', border:`1px solid ${!uploading && file && mapName.trim() ? T.gold : T.border}`, color: !uploading && file && mapName.trim() ? T.gold : T.textDim }}>
                {uploading ? progress || 'UPLOADING…' : 'UPLOAD MAP'}
              </button>
            </div>
          )}

          {tab === 'edit' && activeMap && (
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ fontSize:'10px', color:T.textMuted, background:T.surface, borderRadius:'3px', padding:'8px 12px', border:`1px solid ${T.border}` }}>
                Editing: <span style={{ color:T.gold, fontFamily:"'Cinzel',serif" }}>{activeMap.name}</span>
              </div>

              <FieldLabel label="MAP NAME">
                <input value={editName} onChange={e => setEditName(e.target.value)} style={inputSt} />
              </FieldLabel>

              <FieldLabel label="GRID DIMENSIONS (cells)">
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <input type="number" value={editWidthCells} onChange={e => setEditWidthCells(parseInt(e.target.value)||1)} min={1} max={200}
                    style={{ ...inputSt, width:'60px', flex:'none' }} placeholder="W" />
                  <span style={{ color:T.textDim }}>×</span>
                  <input type="number" value={editHeightCells} onChange={e => setEditHeightCells(parseInt(e.target.value)||1)} min={1} max={200}
                    style={{ ...inputSt, width:'60px', flex:'none' }} placeholder="H" />
                  <span style={{ fontSize:'10px', color:T.textDim }}>squares</span>
                </div>
              </FieldLabel>

              <FieldLabel label="FEET PER SQUARE">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={editFeetPerCell} onChange={e => setEditFeetPerCell(parseInt(e.target.value)||5)} min={1} max={500}
                    style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize:'10px', color:T.textDim }}>ft / square — ruler + AoE scale</span>
                </div>
              </FieldLabel>

              <FieldLabel label="DISPLAY SIZE (px)">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={editGridSize} onChange={e => setEditGridSize(parseInt(e.target.value)||70)} min={20} max={200}
                    style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize:'10px', color:T.textDim }}>pixels per square at 100%</span>
                </div>
              </FieldLabel>

              {error && <div style={{ fontSize:'11px', color:T.hp }}>{error}</div>}

              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={saveEdit} disabled={editSaving}
                  style={{ flex:2, fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.14em', padding:'11px', borderRadius:'3px', cursor: editSaving ? 'not-allowed' : 'pointer', background: T.gold+'22', border:`1px solid ${T.gold}`, color:T.gold }}>
                  {editSaving ? 'SAVING…' : 'SAVE CHANGES'}
                </button>
                <button onClick={() => setTab('maps')}
                  style={{ flex:1, fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.14em', padding:'11px', borderRadius:'3px', cursor:'pointer', background:'transparent', border:`1px solid ${T.border}`, color:T.textMuted }}>
                  CANCEL
                </button>
              </div>
            </div>
          )}

          {tab === 'sections' && (
            <FogSectionsPanel
              sections={fogSections}
              sessionId={sessionId}
              activeTool={activeTool}
              dispatch={dispatch}
              setTool={(t) => dispatch({ type: 'SET_TOOL', tool: t })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Fog Sections Panel ─────────────────────────────────────────────────────

function FogSectionsPanel({ sections, sessionId, activeTool, dispatch, setTool }: {
  sections: import('./types').FogSection[];
  sessionId: string;
  activeTool: ToolMode;
  dispatch: (a: Action) => void;
  setTool: (t: ToolMode) => void;
}) {
  const [deleting, setDeleting] = React.useState<string | null>(null);

  const toggleSection = async (section: import('./types').FogSection) => {
    try {
      const { data } = await api.patch(`/vtt/sessions/${sessionId}/fog-sections/${section.id}`, { is_hidden: !section.is_hidden });
      dispatch({ type: 'FOG_SECTION_UPDATED', section: data });
    } catch (e) { console.error(e); }
  };

  const deleteSection = async (sectionId: string) => {
    setDeleting(sectionId);
    try {
      await api.delete(`/vtt/sessions/${sessionId}/fog-sections/${sectionId}`);
      dispatch({ type: 'FOG_SECTION_REMOVED', section_id: sectionId });
    } catch (e) { console.error(e); }
    setDeleting(null);
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
      <div style={{ fontSize:'10px', color:T.textMuted, lineHeight:'1.5' }}>
        Fog sections let you toggle named regions on/off instantly. Use the <span style={{ color:'rgba(100,180,255,0.9)' }}>⬡ PAINT SECTION</span> tool to define a region, then save it here.
      </div>

      <button onClick={() => setTool(activeTool === 'fog_section' ? 'select' : 'fog_section')}
        style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', letterSpacing:'0.12em', padding:'9px', borderRadius:'3px', cursor:'pointer',
          background: activeTool === 'fog_section' ? 'rgba(100,180,255,0.15)' : 'transparent',
          border: `1px solid ${activeTool === 'fog_section' ? 'rgba(100,180,255,0.6)' : T.border}`,
          color: activeTool === 'fog_section' ? 'rgba(100,180,255,0.9)' : T.textMuted }}>
        {activeTool === 'fog_section' ? '⬡ PAINTING — click canvas to add cells' : '⬡ PAINT NEW SECTION'}
      </button>

      {sections.length === 0 && (
        <div style={{ fontSize:'10px', color:T.textDim, textAlign:'center', padding:'12px 0' }}>
          No sections defined yet.
        </div>
      )}

      {sections.map(sec => (
        <div key={sec.id} style={{ display:'flex', alignItems:'center', gap:'8px', background:T.surface, borderRadius:'4px', padding:'8px 10px', border:`1px solid ${sec.is_hidden ? T.hp+'44' : T.border}` }}>
          <button onClick={() => toggleSection(sec)} title={sec.is_hidden ? 'Section hidden — click to reveal' : 'Section visible — click to hide'}
            style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:'14px', lineHeight:1, color: sec.is_hidden ? T.hp : T.green }}>
            {sec.is_hidden ? '🌑' : '👁'}
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'11px', color: sec.is_hidden ? T.hp : T.text, letterSpacing:'0.08em' }}>{sec.name}</div>
            <div style={{ fontSize:'9px', color:T.textDim }}>{sec.cells.length} cells · {sec.is_hidden ? 'HIDDEN' : 'VISIBLE'}</div>
          </div>
          <button onClick={() => deleteSection(sec.id)} disabled={deleting === sec.id} title="Delete section"
            style={{ background:'transparent', border:'none', cursor:'pointer', fontSize:'12px', color:T.textDim }}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Token Place Modal ──────────────────────────────────────────────────────

type SortKey = 'name' | 'classification' | 'hp';

const CLASS_ORDER: Record<string, number> = { minion:0, standard:1, elite:2, boss:3 };
const CLASS_COLOR: Record<string, string> = { minion:T.textMuted, standard:T.text, elite:T.gold, boss:T.hp };

function TokenPlaceModal({ sessionId, socket, dispatch, onClose }: {
  sessionId: string;
  socket:    { rollAttack: (p: any) => void; broadcastTokenPlaced: (t: unknown) => void };
  dispatch:  (action: Action) => void;
  onClose:   () => void;
}) {
  const [search,     setSearch]     = useState('');
  const [sortKey,    setSortKey]    = useState<SortKey>('name');
  const [sortDir,    setSortDir]    = useState<'asc'|'desc'>('asc');
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [placing,    setPlacing]    = useState<EnemyStatBlock | null>(null);
  const [label,      setLabel]      = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [rollVis,    setRollVis]    = useState<'public'|'dm'>('public');

  const { data } = useQuery({
    queryKey: ['library', 'enemies'],
    queryFn:  () => api.get('/library/enemies').then(r => r.data?.data ?? []),
    staleTime: 5 * 60_000,
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const enemies: EnemyStatBlock[] = [...(data ?? [])]
    .filter((e: EnemyStatBlock) => !search || e.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a: EnemyStatBlock, b: EnemyStatBlock) => {
      let cmp = 0;
      if (sortKey === 'name')           cmp = a.name.localeCompare(b.name);
      if (sortKey === 'classification') cmp = (CLASS_ORDER[a.classification]??0) - (CLASS_ORDER[b.classification]??0);
      if (sortKey === 'hp')             cmp = a.hp - b.hp;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const placeToken = async (enemy: EnemyStatBlock) => {
    setSubmitting(true);
    try {
      const instResp  = await api.post(`/vtt/sessions/${sessionId}/enemies`, { enemy_id: enemy.id, label: label || enemy.name, max_hp: enemy.hp });
      const tokenResp = await api.post(`/vtt/sessions/${sessionId}/tokens`,  { entity_type:'enemy', entity_id: instResp.data.id, cell_x:0, cell_y:0, label: label || enemy.name });
      dispatch({ type:'TOKEN_PLACED', token: tokenResp.data });
      socket.broadcastTokenPlaced(tokenResp.data);
      onClose();
    } catch (e) { console.error(e); }
    setSubmitting(false);
  };

  const rollAttack = (enemy: EnemyStatBlock, atkName: string, formula: string, dmgType: string) => {
    const match   = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    const results: number[] = [];
    if (match) {
      const count = parseInt(match[1]), sides = parseInt(match[2]);
      for (let i=0; i<count; i++) results.push(Math.floor(Math.random()*sides)+1);
    }
    const total = results.reduce((s,n)=>s+n,0) + parseInt(formula.match(/[+-]\d+$/)?.[0]??'0');
    socket.rollAttack({ source_label:`${enemy.name} — ${atkName}`, formula, results, total, damage_type: dmgType, visibility: rollVis });
  };

  const sortBtn = (key: SortKey, label: string) => (
    <button onClick={() => toggleSort(key)}
      style={{ background: sortKey===key ? T.gold+'18' : 'transparent', border:`1px solid ${sortKey===key ? T.gold : T.border}`, borderRadius:'2px', padding:'3px 8px', cursor:'pointer', color: sortKey===key ? T.gold : T.textMuted, fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.12em', display:'flex', alignItems:'center', gap:'3px' }}>
      {label} {sortKey===key ? (sortDir==='asc' ? '↑' : '↓') : ''}
    </button>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={onClose}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px', width:'520px', maxWidth:'92vw', height:'78vh', display:'flex', flexDirection:'column', overflow:'hidden' }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:'13px', letterSpacing:'0.14em', color:T.text }}>PLACE TOKEN</span>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize:'10px', color:T.textDim }}>Roll visibility:</span>
            {(['public','dm'] as const).map(v => (
              <button key={v} onClick={() => setRollVis(v)}
                style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.1em', padding:'2px 8px', borderRadius:'2px', cursor:'pointer', background: rollVis===v ? T.gold+'18' : 'transparent', border:`1px solid ${rollVis===v ? T.gold : T.border}`, color: rollVis===v ? T.gold : T.textDim }}>
                {v.toUpperCase()}
              </button>
            ))}
            <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize:'18px', lineHeight:1, marginLeft:'4px' }}>×</button>
          </div>
        </div>

        {/* Search + Sort */}
        <div style={{ padding:'10px 16px', borderBottom:`1px solid ${T.border}`, flexShrink:0, display:'flex', flexDirection:'column', gap:'8px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search enemies…" autoFocus style={inputSt} />
          <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.14em', color:T.textDim, marginRight:'4px' }}>SORT:</span>
            {sortBtn('name',           'NAME')}
            {sortBtn('classification', 'CLASS')}
            {sortBtn('hp',             'HP')}
          </div>
        </div>

        {/* Enemy list */}
        <div style={{ flex:1, overflowY:'auto', padding:'8px 12px', display:'flex', flexDirection:'column', gap:'4px' }}>
          {enemies.length === 0 && (
            <div style={{ textAlign:'center', padding:'24px 0', color:T.textDim, fontFamily:"'Cinzel',serif", fontSize:'11px', letterSpacing:'0.14em' }}>NO ENEMIES FOUND</div>
          )}
          {enemies.map(enemy => {
            const isExpanded = expanded === enemy.id;
            const isPlacing  = placing?.id === enemy.id;
            return (
              <div key={enemy.id} style={{ background:T.surface, border:`1px solid ${isExpanded ? T.border : T.border}`, borderRadius:'4px', overflow:'hidden' }}>

                {/* Row */}
                <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 12px' }}>
                  {/* Expand toggle — clicking the name/stats area */}
                  <div style={{ flex:1, cursor:'pointer', minWidth:0 }} onClick={() => setExpanded(isExpanded ? null : enemy.id)}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <span style={{ fontFamily:"'Cinzel',serif", fontSize:'12px', color:T.text, letterSpacing:'0.08em' }}>{enemy.name}</span>
                      <span style={{ fontSize:'9px', color: CLASS_COLOR[enemy.classification]??T.textMuted, textTransform:'uppercase', letterSpacing:'0.12em' }}>{enemy.classification}</span>
                      <span style={{ fontSize:'9px', color:T.textDim, marginLeft:'auto' }}>HP {enemy.hp}</span>
                    </div>
                  </div>
                  {/* Chevron */}
                  <span style={{ fontSize:'10px', color:T.textDim, cursor:'pointer', flexShrink:0 }} onClick={() => setExpanded(isExpanded ? null : enemy.id)}>
                    {isExpanded ? '▲' : '▼'}
                  </span>
                  {/* Add button — separate from expand */}
                  <button
                    onClick={e => { e.stopPropagation(); setPlacing(enemy); setLabel(enemy.name); }}
                    style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.1em', padding:'4px 10px', borderRadius:'2px', cursor:'pointer', background:T.gold+'18', border:`1px solid ${T.gold}44`, color:T.gold, flexShrink:0 }}
                  >+ ADD</button>
                </div>

                {/* Expanded stat block */}
                {isExpanded && (
                  <div style={{ padding:'0 12px 12px', borderTop:`1px solid ${T.border}` }}>
                    {/* Attributes */}
                    <div style={{ display:'flex', gap:'12px', padding:'8px 0 6px', flexWrap:'wrap' }}>
                      {([['POW',enemy.power],['AGI',enemy.agility],['FOC',enemy.focus],['PRE',enemy.presence]] as [string,number][]).map(([k,v]) => (
                        <div key={k} style={{ textAlign:'center' }}>
                          <div style={{ fontSize:'8px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>{k}</div>
                          <div style={{ fontSize:'13px', color:T.text, fontWeight:700 }}>{v}</div>
                          <div style={{ fontSize:'9px', color:T.textMuted }}>{v>=10?'+':''}{Math.floor((v-10)/2)}</div>
                        </div>
                      ))}
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:'8px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>HP</div>
                        <div style={{ fontSize:'13px', color:T.hp, fontWeight:700 }}>{enemy.hp}</div>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:'8px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>BASE RP</div>
                        <div style={{ fontSize:'13px', color:T.rp, fontWeight:700 }}>{enemy.base_rp}</div>
                      </div>
                    </div>

                    {/* Attacks */}
                    {enemy.attacks.length > 0 && (
                      <>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.14em', color:T.textDim, margin:'6px 0 4px' }}>ATTACKS</div>
                        {enemy.attacks.map((atk, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:T.card, borderRadius:'2px', padding:'5px 8px', marginBottom:'3px' }}>
                            <div>
                              <span style={{ fontSize:'11px', color:T.text }}>{atk.name}</span>
                              <span style={{ fontSize:'9px', color:T.textMuted, marginLeft:'8px' }}>{atk.damage_dice} {atk.damage_type}</span>
                            </div>
                            <button onClick={() => rollAttack(enemy, atk.name, atk.damage_dice, atk.damage_type)}
                              style={{ background:T.hp+'18', border:`1px solid ${T.hp}44`, borderRadius:'2px', padding:'2px 8px', cursor:'pointer', color:T.hp, fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.1em' }}>
                              ROLL
                            </button>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Traits */}
                    {enemy.traits.length > 0 && (
                      <>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.14em', color:T.textDim, margin:'8px 0 4px' }}>TRAITS</div>
                        {enemy.traits.map((trait, i) => (
                          <div key={i} style={{ fontSize:'10px', color:T.textMuted, marginBottom:'4px', lineHeight:'1.5' }}>
                            <span style={{ color:T.text, fontFamily:"'Cinzel',serif" }}>{trait.name}:</span> {trait.description}
                          </div>
                        ))}
                      </>
                    )}

                    {/* Description */}
                    {enemy.description && (
                      <div style={{ fontSize:'10px', color:T.textDim, marginTop:'8px', lineHeight:'1.6', fontStyle:'italic' }}>{enemy.description}</div>
                    )}
                  </div>
                )}

                {/* Label input — shown when this enemy is selected for placement */}
                {isPlacing && (
                  <div style={{ padding:'8px 12px', background:T.card, borderTop:`1px solid ${T.border}`, display:'flex', gap:'8px', alignItems:'center' }}>
                    <input
                      value={label} onChange={e => setLabel(e.target.value)} autoFocus
                      onKeyDown={e => e.key==='Enter' && placeToken(enemy)}
                      placeholder="Label (e.g. Goblin A)"
                      style={{ ...inputSt, flex:1 }}
                    />
                    <button onClick={() => { setPlacing(null); setLabel(''); }}
                      style={{ background:'transparent', border:`1px solid ${T.border}`, borderRadius:'2px', padding:'6px 10px', cursor:'pointer', color:T.textMuted, fontFamily:"'Cinzel',serif", fontSize:'9px' }}>
                      CANCEL
                    </button>
                    <button onClick={() => placeToken(enemy)} disabled={submitting}
                      style={{ background:T.gold+'22', border:`1px solid ${T.gold}`, borderRadius:'2px', padding:'6px 14px', cursor: submitting ? 'not-allowed' : 'pointer', color:T.gold, fontFamily:"'Cinzel',serif", fontSize:'9px', letterSpacing:'0.1em' }}>
                      {submitting ? 'PLACING…' : 'PLACE'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', letterSpacing:'0.18em', color:T.textDim, marginBottom:'6px' }}>{label}</div>
      {children}
    </div>
  );
}

const inputSt: React.CSSProperties = {
  background:T.surface, border:`1px solid ${T.border}`, borderRadius:'2px',
  padding:'7px 10px', color:T.text, fontSize:'12px', outline:'none',
  width:'100%', boxSizing:'border-box',
};