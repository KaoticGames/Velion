/**
 * DMToolbar.tsx — Left-side DM tool palette
 */

import React, { useState, useRef } from 'react';
import { useQuery }         from '@tanstack/react-query';
import { api }              from '@/lib/api';
import type { Action }      from './useVTTState';
import type { ToolMode, FogBrushShape, FogBrushMode, VTTMap, EnemyStatBlock, EnemyInstance, MapToken } from './types';

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
  activeTool:      ToolMode;
  toolColor:       string;
  fogBrushSize:    number;
  fogBrushShape:   FogBrushShape;
  fogBrushMode:    FogBrushMode;
  activeFogLayerId: string | null;
  fogSections:     import('./types').FogSection[];
  campaignMaps:  VTTMap[];
  activeMapId:   string | null;
  sessionId:     string;
  campaignId:    string;
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
  { label:'FOG', tools:[{ id:'fog_open', icon:'☁', title:'Fog layers' }] },
  { label:'MEASURE', tools:[{ id:'ruler', icon:'📏', title:'Ruler (uses feet per cell)' }] },
  { label:'DRAW',    tools:[{ id:'draw_open', icon:'✏', title:'Draw tools' }] },
  { label:'TOKENS',  tools:[{ id:'token_place', icon:'🪙', title:'Place token' }] },
];

const DRAW_TOOLS: Array<{ id: ToolMode; icon: string; title: string; iconSize?: string }> = [
  { id:'marker', icon:'⌖', title:'Pin', iconSize:'32px' },
  { id:'circle', icon:'◯', title:'Circle AoE' },
  { id:'rect',   icon:'□', title:'Square/Rectangle', iconSize:'32px' },
  { id:'line',   icon:'╱', title:'Line' },
  { id:'cone',   icon:'◬', title:'Cone 60°' },
];

export default function DMToolbar(props: Props) {
  const { activeTool, toolColor, fogBrushSize, fogBrushShape, fogBrushMode, activeFogLayerId, fogSections, campaignMaps, activeMapId, sessionId, campaignId, socket, dispatch } = props;
  const [showMapModal,    setShowMapModal]    = useState(false);
  const [showTokenModal,  setShowTokenModal]  = useState(false);
  const [showFogSections, setShowFogSections] = useState(false);
  const [showDrawTools,   setShowDrawTools]   = useState(false);
  const [drawMenuTop,     setDrawMenuTop]     = useState(0);

  const setTool       = (tool: ToolMode)       => dispatch({ type: 'SET_TOOL', tool });
  const setColor      = (color: string)        => dispatch({ type: 'SET_TOOL_COLOR', color });
  const setBrush      = (size: number)           => dispatch({ type: 'SET_FOG_BRUSH_SIZE', size });
  const setBrushShape = (shape: FogBrushShape)    => dispatch({ type: 'SET_FOG_BRUSH_SHAPE', shape });
  const setBrushMode  = (mode: FogBrushMode)      => dispatch({ type: 'SET_FOG_BRUSH_MODE', mode });
  const setActiveLayer = (id: string | null)      => dispatch({ type: 'SET_ACTIVE_FOG_LAYER', id });

  const isDrawTool  = ['marker','circle','rect','line','cone'].includes(activeTool);
  const isPanMode   = activeTool === 'pan';
  const isFogOpen   = activeTool === 'fog' || showFogSections;

  const toggleSection = async (section: import('./types').FogSection) => {
    try {
      const { data } = await api.patch(`/vtt/sessions/${sessionId}/fog-sections/${section.id}`, { is_hidden: !section.is_hidden });
      dispatch({ type: 'FOG_SECTION_UPDATED', section: data });
    } catch (e) { console.error(e); }
  };

  const deleteSection = async (sectionId: string) => {
    try {
      await api.delete(`/vtt/sessions/${sessionId}/fog-sections/${sectionId}`);
      dispatch({ type: 'FOG_SECTION_REMOVED', section_id: sectionId });
    } catch (e) { console.error(e); }
  };

  return (
    <>
      {/* Fog layer navigator panel */}
      {isFogOpen && (
        <FogLayerNavigator
          fogSections={fogSections}
          activeFogLayerId={activeFogLayerId}
          fogBrushMode={fogBrushMode}
          fogBrushShape={fogBrushShape}
          fogBrushSize={fogBrushSize}
          sessionId={sessionId}
          activeTool={activeTool}
          setTool={setTool}
          setActiveLayer={setActiveLayer}
          setBrushMode={setBrushMode}
          setBrushShape={setBrushShape}
          setBrush={setBrush}
          toggleSection={toggleSection}
          deleteSection={deleteSection}
          dispatch={dispatch}
          onClose={() => { setShowFogSections(false); setTool('select'); setActiveLayer(null); }}
        />
      )}

      {/* Main toolbar column */}
      <div style={{
        width:'68px',
        display:'flex',
        flexDirection:'column',
        alignItems:'center',
        background:T.surface,
        border:`1px solid ${T.border}`,
        borderRadius:'10px',
        boxShadow:'0 8px 24px rgba(0,0,0,0.45)',
        flexShrink:0,
        position:'relative',
        overflow:'visible',
        zIndex:30,
      }}>
        <div style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', padding:'10px 0', gap:'6px', overflowY:'auto', overflowX:'visible', maxHeight:'calc(100vh - 170px)' }}>
          <div style={{ width: '28px', height: '1px', background: T.border, marginBottom: '4px' }} />

          {TOOL_GROUPS.map(group => (
          <div key={group.label} style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', marginBottom:'6px', position:'relative' }}>
            {group.tools.map(tool => {
              const isSelectBtn = tool.id === 'select';
              const isFogOpenBtn = tool.id === 'fog_open';
              const isDrawOpenBtn = tool.id === 'draw_open';
              const active = isSelectBtn
                ? (activeTool === 'select' || activeTool === 'pan')
                : isFogOpenBtn
                  ? isFogOpen
                  : isDrawOpenBtn
                    ? (isDrawTool || showDrawTools)
                    : activeTool === tool.id;
              const displayIcon = isSelectBtn && isPanMode ? '✋' : tool.icon;
              return (
                <button key={tool.id} title={isSelectBtn && isPanMode ? 'Pan viewport (click to switch back to select)' : tool.title}
                  onClick={(event) => {
                    if (tool.id === 'token_place') { setShowDrawTools(false); setShowTokenModal(true); return; }
                    if (tool.id === 'fog_open') { setShowDrawTools(false); setShowFogSections(v => !v); return; }
                    if (tool.id === 'draw_open') {
                      const btn = (event?.currentTarget as HTMLButtonElement | undefined);
                      if (btn) setDrawMenuTop(btn.offsetTop);
                      setShowDrawTools(v => !v);
                      return;
                    }
                    setShowDrawTools(false);
                    if (isSelectBtn) { setTool(activeTool === 'select' ? 'pan' : 'select'); }
                    else { setTool(tool.id as ToolMode); }
                  }}
                  style={{ width:'52px', height:'52px', display:'flex', alignItems:'center', justifyContent:'center', background: active ? T.gold+'22' : 'transparent', border:`1px solid ${active ? T.gold : T.border}`, borderRadius:'6px', cursor:'pointer', fontSize: '29px', color: active ? T.gold : T.textMuted, transition:'all 0.12s', position:'relative' }}
                >
                  {displayIcon}
                  {isSelectBtn && isPanMode && (
                    <span style={{ position:'absolute', bottom:'1px', right:'2px', fontSize: '12px', color:T.gold, fontFamily:"'Cinzel',serif" }}>PAN</span>
                  )}
                </button>
              );
            })}

          </div>
          ))}

          <div style={{ width:'32px', height:'1px', background:T.border, margin:'4px 0' }} />



          <div style={{ width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', padding:'0 0 8px' }}>
            <button onClick={() => setShowMapModal(true)} title="Manage maps" style={{ width:'52px', height:'52px', display:'flex', alignItems:'center', justifyContent:'center', background:'transparent', border:`1px solid ${T.border}`, borderRadius:'6px', cursor:'pointer', fontSize: '29px', color:T.gold }}>🗺</button>
          </div>
        </div>
        {showDrawTools && (
          <div style={{
            position:'absolute',
            left:'calc(100% + 10px)',
            top: drawMenuTop,
            display:'flex',
            flexDirection:'column',
            gap:'6px',
            padding:'8px',
            background:T.surface,
            border:`1px solid ${T.border}`,
            borderRadius:'10px',
            boxShadow:'0 8px 24px rgba(0,0,0,0.45)',
            zIndex:60,
          }}>
            {DRAW_TOOLS.map(tool => {
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  title={tool.title}
                  onClick={() => { setTool(tool.id); }}
                  style={{
                    width:'52px',
                    height:'52px',
                    display:'flex',
                    alignItems:'center',
                    justifyContent:'center',
                    background: active ? toolColor + '22' : 'transparent',
                    border:`1px solid ${active ? toolColor : T.border}`,
                    borderRadius:'6px',
                    cursor:'pointer',
                    fontSize: tool.iconSize ?? '26px',
                    color: toolColor,
                  }}
                >
                  {tool.icon}
                </button>
              );
            })}
            <div style={{ width:'100%', height:'1px', background:T.border, margin:'2px 0' }} />
            <div
              title="Draw color"
              style={{
                width:'52px',
                height:'52px',
                display:'flex',
                alignItems:'center',
                justifyContent:'center',
                border:`1px solid ${T.border}`,
                borderRadius:'6px',
                background:T.card,
                position:'relative',
                overflow:'hidden',
              }}
            >
              <span style={{
                width:'26px',
                height:'26px',
                borderRadius:'50%',
                background:toolColor,
                border:'1px solid rgba(255,255,255,0.35)',
                boxShadow:'0 0 0 1px rgba(0,0,0,0.35) inset',
              }} />
              <input
                type="color"
                value={toolColor}
                onChange={e => setColor(e.target.value)}
                style={{
                  position:'absolute',
                  inset:0,
                  opacity:0,
                  cursor:'pointer',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {showMapModal   && <MapModal campaignId={campaignId} campaignMaps={campaignMaps} activeMapId={activeMapId} sessionId={sessionId} fogSections={fogSections} activeTool={activeTool} socket={socket} dispatch={dispatch} onClose={() => setShowMapModal(false)} />}
      {showTokenModal && <TokenPlaceModal sessionId={sessionId} socket={socket} dispatch={dispatch} onClose={() => { setShowTokenModal(false); setTool('select'); }} />}
    </>
  );
}


// ── Fog Layer Navigator ────────────────────────────────────────────────────

function FogLayerNavigator({
  fogSections, activeFogLayerId, fogBrushMode, fogBrushShape, fogBrushSize,
  sessionId, activeTool, setTool, setActiveLayer, setBrushMode, setBrushShape, setBrush,
  toggleSection, deleteSection, dispatch, onClose,
}: {
  fogSections:      import('./types').FogSection[];
  activeFogLayerId: string | null;
  fogBrushMode:     FogBrushMode;
  fogBrushShape:    FogBrushShape;
  fogBrushSize:     number;
  sessionId:        string;
  activeTool:       ToolMode;
  setTool:          (t: ToolMode) => void;
  setActiveLayer:   (id: string | null) => void;
  setBrushMode:     (m: FogBrushMode) => void;
  setBrushShape:    (s: FogBrushShape) => void;
  setBrush:         (n: number) => void;
  toggleSection:    (sec: import('./types').FogSection) => void;
  deleteSection:    (id: string) => void;
  dispatch:         (a: Action) => void;
  onClose:          () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');

  const createLayer = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { data: section } = await api.post(`/vtt/sessions/${sessionId}/fog-sections`, {
        name: newName.trim() || `Layer ${fogSections.length + 1}`,
      });
      dispatch({ type: 'FOG_SECTION_ADDED', section });
      setNewName('');
      // Auto-select and activate the new layer
      setActiveLayer(section.id);
      setTool('fog');
    } catch (e) { console.error(e); }
    setCreating(false);
  };

  const selectLayer = (id: string) => {
    if (activeFogLayerId === id && activeTool === 'fog') {
      // Clicking the active layer again deselects it
      setActiveLayer(null);
      setTool('select');
    } else {
      setActiveLayer(id);
      setTool('fog');
    }
  };

  const isEditing = activeTool === 'fog' && activeFogLayerId !== null;

  return (
    <div style={{ width: '220px', display: 'flex', flexDirection: 'column', background: T.surface, borderRight: `1px solid ${T.border}`, flexShrink: 0 }}>

      {/* Header */}
      <div style={{ padding: '10px 12px 8px', fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.2em', color: T.textMuted, borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>FOG LAYERS</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>✕</button>
      </div>

      {/* Brush controls — only when a layer is selected and editing */}
      {isEditing && (
        <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {/* Active layer label + stop editing button */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.12em', color: T.rp }}>
              ● {fogSections.find(s => s.id === activeFogLayerId)?.name ?? 'LAYER'}
            </span>
            <button
              onClick={() => { setActiveLayer(null); setTool('select'); }}
              title="Stop editing this layer"
              style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.1em', padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', background: 'transparent', border: `1px solid ${T.border}`, color: T.textDim }}>
              DONE
            </button>
          </div>
          {/* Paint / Erase toggle */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['paint', 'erase'] as FogBrushMode[]).map(mode => (
              <button key={mode} onClick={() => setBrushMode(mode)}
                style={{ flex: 1, fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.1em', padding: '5px', borderRadius: '3px', cursor: 'pointer',
                  background: fogBrushMode === mode ? (mode === 'paint' ? T.hp + '22' : T.green + '22') : 'transparent',
                  border: `1px solid ${fogBrushMode === mode ? (mode === 'paint' ? T.hp : T.green) : T.border}`,
                  color: fogBrushMode === mode ? (mode === 'paint' ? T.hp : T.green) : T.textMuted,
                }}>
                {mode === 'paint' ? '● PAINT' : '○ ERASE'}
              </button>
            ))}
          </div>

          {/* Brush shape */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginRight: '2px' }}>SHAPE</span>
            {([['○', 'circle'], ['□', 'square'], ['⊕', 'fill']] as [string, FogBrushShape][]).map(([icon, shape]) => (
              <button key={shape} onClick={() => setBrushShape(shape)}
                style={{ width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: fogBrushShape === shape ? T.rp + '22' : 'transparent',
                  border: `1px solid ${fogBrushShape === shape ? T.rp : T.border}`,
                  borderRadius: '3px', cursor: 'pointer', color: fogBrushShape === shape ? T.rp : T.textMuted, fontSize: '16px' }}>
                {icon}
              </button>
            ))}
          </div>

          {/* Brush size — hidden for fill */}
          {fogBrushShape !== 'fill' && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em', color: T.textDim, marginRight: '2px' }}>SIZE</span>
              {[0, 1, 2, 3].map(size => (
                <button key={size} onClick={() => setBrush(size)}
                  style={{ flex: 1, height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: fogBrushSize === size ? T.rp + '22' : 'transparent',
                    border: `1px solid ${fogBrushSize === size ? T.rp : T.border}`,
                    borderRadius: '3px', cursor: 'pointer', color: fogBrushSize === size ? T.rp : T.textMuted,
                    fontFamily: "'Cinzel',serif", fontSize: '12px' }}>
                  {size === 0 ? '1' : `${size * 2 + 1}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Layer list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {fogSections.length === 0 && (
          <div style={{ fontSize: '14px', color: T.textDim, textAlign: 'center', padding: '16px 4px', lineHeight: 1.6 }}>
            No layers yet.<br />Create one below.
          </div>
        )}
        {fogSections.map(sec => {
          const isActive = sec.id === activeFogLayerId;
          return (
            <div key={sec.id}
              onClick={() => selectLayer(sec.id)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 10px', borderRadius: '3px', cursor: 'pointer',
                background: isActive ? T.rp + '18' : T.card,
                border: `1px solid ${isActive ? T.rp + '88' : sec.is_hidden ? T.hp + '33' : T.border}`,
              }}>
              {/* Visibility toggle */}
              <button
                onClick={e => { e.stopPropagation(); toggleSection(sec); }}
                title={sec.is_hidden ? 'Hidden — click to show' : 'Visible — click to hide'}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', lineHeight: 1, color: sec.is_hidden ? T.textDim : T.green, padding: 0, flexShrink: 0 }}>
                {sec.is_hidden ? '🌑' : '👁'}
              </button>

              {/* Name + status */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.06em', color: isActive ? T.rp : sec.is_hidden ? T.textDim : T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sec.name}
                </div>
                <div style={{ fontSize: '12px', color: T.textDim }}>
                  {isActive && activeTool === 'fog' ? '● editing' : sec.is_hidden ? 'hidden' : 'visible'}
                </div>
              </div>

              {/* Delete */}
              <button
                onClick={e => { e.stopPropagation(); deleteSection(sec.id); if (isActive) { setActiveLayer(null); setTool('select'); } }}
                title="Delete layer"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px', color: T.textDim, flexShrink: 0, padding: '2px' }}>
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* New layer */}
      <div style={{ padding: '8px 10px', borderTop: `1px solid ${T.border}`, display: 'flex', gap: '6px' }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createLayer()}
          placeholder="Layer name..."
          style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: '3px', padding: '6px 8px', color: T.text, fontSize: '14px', fontFamily: "'EB Garamond', serif", outline: 'none' }}
        />
        <button onClick={createLayer} disabled={creating}
          style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.1em', padding: '6px 10px', borderRadius: '3px', cursor: creating ? 'not-allowed' : 'pointer', background: T.gold + '22', border: `1px solid ${T.gold}`, color: T.gold, flexShrink: 0 }}>
          + NEW
        </button>
      </div>
    </div>
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
  const [tab,             setTab]             = useState<'maps'|'upload'|'edit'|'sections'>('maps');
  const [mapName,         setMapName]         = useState('');
  const [gridSize,        setGridSize]        = useState(70);
  const [feetPerCell,     setFeetPerCell]     = useState(5);
  const [file,            setFile]            = useState<File | null>(null);
  const [preview,         setPreview]         = useState<string | null>(null);
  const [imgDims,         setImgDims]         = useState<{ w: number; h: number } | null>(null);
  const [uploading,       setUploading]       = useState(false);
  const [progress,        setProgress]        = useState('');
  const [error,           setError]           = useState('');
  const [editName,        setEditName]        = useState('');
  const [editGridSize,    setEditGridSize]    = useState(70);
  const [editFeetPerCell, setEditFeetPerCell] = useState(5);
  const [editWidthCells,  setEditWidthCells]  = useState(20);
  const [editHeightCells, setEditHeightCells] = useState(20);
  const [editSaving,      setEditSaving]      = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleSection = async (section: import('./types').FogSection) => {
    try {
      const { data } = await api.patch(`/vtt/sessions/${sessionId}/fog-sections/${section.id}`, { is_hidden: !section.is_hidden });
      dispatch({ type: 'FOG_SECTION_UPDATED', section: data });
    } catch (e) { console.error(e); }
  };

  const deleteSection = async (sectionId: string) => {
    try {
      await api.delete(`/vtt/sessions/${sessionId}/fog-sections/${sectionId}`);
      dispatch({ type: 'FOG_SECTION_REMOVED', section_id: sectionId });
    } catch (e) { console.error(e); }
  };

  const { data: mapsData, refetch } = useQuery({
    queryKey: ['campaign-maps', campaignId],
    queryFn:  () => api.get(`/vtt/campaigns/${campaignId}/maps`).then(r => r.data?.data ?? []),
    initialData: campaignMaps,
  });
  const maps: VTTMap[] = mapsData ?? [];
  const activeMap = maps.find(m => m.id === activeMapId) ?? null;

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
        name: editName.trim() || activeMap.name,
        grid_cell_size: editGridSize,
        feet_per_cell: editFeetPerCell,
        width_cells: editWidthCells,
        height_cells: editHeightCells,
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
    setFile(f); setError(''); setImgDims(null);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
      const img = new Image();
      img.onload = () => { setImgDims({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.src = url;
    } else { setPreview(null); }
  };

  const uploadMap = async () => {
    if (!file || !mapName.trim()) { setError('Map name and image file are required.'); return; }
    setUploading(true); setError('');
    try {
      const width_cells  = imgDims ? Math.ceil(imgDims.w / gridSize) : 20;
      const height_cells = imgDims ? Math.ceil(imgDims.h / gridSize) : 20;
      setProgress('Preparing upload…');
      const { data: urlData } = await api.post(`/vtt/campaigns/${campaignId}/maps/upload-url`, { filename: file.name, content_type: file.type || 'image/jpeg' });
      setProgress('Uploading image…');
      await fetch(urlData.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'image/jpeg' } });
      setProgress('Saving map…');
      const { data: map } = await api.post(`/vtt/campaigns/${campaignId}/maps`, { name: mapName.trim(), image_url: urlData.public_url, grid_cell_size: gridSize, feet_per_cell: feetPerCell, width_cells, height_cells });
      await refetch();
      dispatch({ type: 'MAP_CHANGED', map, tokens: [], shapes: [], fogCells: [], fogSections: [] });
      setTab('maps'); setMapName(''); setFile(null); setPreview(null); setImgDims(null);
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
          <span style={{ fontFamily:"'Cinzel',serif", fontSize: '16px', letterSpacing:'0.14em', color:T.text }}>MAP MANAGER</span>
          <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize: '21px', lineHeight:1 }}>x</button>
        </div>

        <div style={{ display:'flex', borderBottom:`1px solid ${T.border}` }}>
          {([['maps','MY MAPS'],['upload','UPLOAD'],['edit','EDIT MAP'],['sections','FOG SECTIONS']] as const).map(([t, label]) => (
            <button key={t} onClick={() => t === 'edit' ? openEdit() : setTab(t)}
              disabled={t === 'edit' && !activeMapId}
              style={{ flex:1, padding:'10px', background:'transparent', border:'none', borderBottom: tab===t ? `2px solid ${T.gold}` : '2px solid transparent', cursor: (t === 'edit' && !activeMapId) ? 'not-allowed' : 'pointer', fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.16em', color: tab===t ? T.gold : (t === 'edit' && !activeMapId) ? T.textDim : T.textMuted }}
            >{label}</button>
          ))}
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'16px 20px' }}>
          {tab === 'maps' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
              {maps.length === 0 && <div style={{ textAlign:'center', padding:'28px 0', color:T.textDim, fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.14em' }}>NO MAPS YET</div>}
              {maps.map(m => (
                <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'12px', background:T.surface, border:`1px solid ${m.id===activeMapId ? T.gold+'55' : T.border}`, borderRadius:'4px', padding:'10px 14px' }}>
                  <div style={{ width:'48px', height:'36px', borderRadius:'3px', background:T.bg, border:`1px solid ${T.border}`, overflow:'hidden', flexShrink:0 }}>
                    <img src={m.image_url} alt={m.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontFamily:"'Cinzel',serif", fontSize: '15px', color: m.id===activeMapId ? T.gold : T.text, letterSpacing:'0.1em', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.id===activeMapId && '▶ '}{m.name}</div>
                    <div style={{ fontSize: '13px', color:T.textDim, marginTop:'2px' }}>{m.width_cells}x{m.height_cells} cells</div>
                  </div>
                  <button onClick={() => { socket.changeMap(m.id); onClose(); }} disabled={m.id===activeMapId}
                    style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.12em', padding:'5px 12px', borderRadius:'2px', cursor: m.id===activeMapId ? 'default' : 'pointer', background: m.id===activeMapId ? 'transparent' : T.gold+'18', border:`1px solid ${m.id===activeMapId ? T.border : T.gold}`, color: m.id===activeMapId ? T.textDim : T.gold, flexShrink:0 }}>
                    {m.id===activeMapId ? 'ACTIVE' : 'SET ACTIVE'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'upload' && (
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <FieldLabel label="MAP NAME"><input value={mapName} onChange={e => setMapName(e.target.value)} placeholder="e.g. Dungeon Level 1" style={inputSt} /></FieldLabel>
              <FieldLabel label="MAP IMAGE">
                <div onClick={() => fileRef.current?.click()} style={{ width:'100%', minHeight:'120px', background:T.surface, border:`2px dashed ${file ? T.gold+'66' : T.border}`, borderRadius:'4px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', overflow:'hidden' }}>
                  {preview ? <img src={preview} alt="preview" style={{ maxWidth:'100%', maxHeight:'180px', objectFit:'contain' }} /> : (
                    <div style={{ textAlign:'center', padding:'20px' }}>
                      <div style={{ fontSize: '31px', marginBottom:'8px' }}>🗺</div>
                      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '13px', letterSpacing:'0.14em', color:T.textMuted }}>CLICK TO SELECT IMAGE</div>
                    </div>
                  )}
                  <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} style={{ display:'none' }} />
                </div>
                {file && <div style={{ fontSize: '13px', color:T.textMuted, marginTop:'4px' }}>{file.name}</div>}
              </FieldLabel>
              <FieldLabel label="DISPLAY SIZE (px)">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={gridSize} onChange={e => setGridSize(parseInt(e.target.value)||70)} min={20} max={200} style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize: '13px', color:T.textDim }}>pixels per square</span>
                </div>
                {imgDims && <div style={{ fontSize: '13px', color:T.green, marginTop:'4px' }}>Image: {Math.ceil(imgDims.w/gridSize)}x{Math.ceil(imgDims.h/gridSize)} cells</div>}
              </FieldLabel>
              <FieldLabel label="FEET PER SQUARE">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={feetPerCell} onChange={e => setFeetPerCell(parseInt(e.target.value)||5)} min={1} max={500} style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize: '13px', color:T.textDim }}>ft — ruler + AoE use this</span>
                </div>
              </FieldLabel>
              {progress && <div style={{ fontSize: '14px', color:T.rp }}>{progress}</div>}
              {error    && <div style={{ fontSize: '14px', color:T.hp }}>{error}</div>}
              <button onClick={uploadMap} disabled={uploading || !file || !mapName.trim()}
                style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.14em', padding:'11px', borderRadius:'3px', cursor: uploading || !file || !mapName.trim() ? 'not-allowed' : 'pointer', background: !uploading && file && mapName.trim() ? T.gold+'22' : 'transparent', border:`1px solid ${!uploading && file && mapName.trim() ? T.gold : T.border}`, color: !uploading && file && mapName.trim() ? T.gold : T.textDim }}>
                {uploading ? progress || 'UPLOADING...' : 'UPLOAD MAP'}
              </button>
            </div>
          )}

          {tab === 'edit' && activeMap && (
            <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
              <div style={{ fontSize: '13px', color:T.textMuted, background:T.surface, borderRadius:'3px', padding:'8px 12px', border:`1px solid ${T.border}` }}>
                Editing: <span style={{ color:T.gold, fontFamily:"'Cinzel',serif" }}>{activeMap.name}</span>
              </div>
              <FieldLabel label="MAP NAME"><input value={editName} onChange={e => setEditName(e.target.value)} style={inputSt} /></FieldLabel>
              <FieldLabel label="GRID DIMENSIONS (cells)">
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <input type="number" value={editWidthCells} onChange={e => setEditWidthCells(parseInt(e.target.value)||1)} min={1} max={200} style={{ ...inputSt, width:'60px', flex:'none' }} placeholder="W" />
                  <span style={{ color:T.textDim }}>x</span>
                  <input type="number" value={editHeightCells} onChange={e => setEditHeightCells(parseInt(e.target.value)||1)} min={1} max={200} style={{ ...inputSt, width:'60px', flex:'none' }} placeholder="H" />
                  <span style={{ fontSize: '13px', color:T.textDim }}>squares</span>
                </div>
              </FieldLabel>
              <FieldLabel label="FEET PER SQUARE">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={editFeetPerCell} onChange={e => setEditFeetPerCell(parseInt(e.target.value)||5)} min={1} max={500} style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize: '13px', color:T.textDim }}>ft / square</span>
                </div>
              </FieldLabel>
              <FieldLabel label="DISPLAY SIZE (px)">
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <input type="number" value={editGridSize} onChange={e => setEditGridSize(parseInt(e.target.value)||70)} min={20} max={200} style={{ ...inputSt, width:'70px', flex:'none' }} />
                  <span style={{ fontSize: '13px', color:T.textDim }}>pixels per square</span>
                </div>
              </FieldLabel>
              {error && <div style={{ fontSize: '14px', color:T.hp }}>{error}</div>}
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={saveEdit} disabled={editSaving} style={{ flex:2, fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.14em', padding:'11px', borderRadius:'3px', cursor: editSaving ? 'not-allowed' : 'pointer', background:T.gold+'22', border:`1px solid ${T.gold}`, color:T.gold }}>{editSaving ? 'SAVING...' : 'SAVE CHANGES'}</button>
                <button onClick={() => setTab('maps')} style={{ flex:1, fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.14em', padding:'11px', borderRadius:'3px', cursor:'pointer', background:'transparent', border:`1px solid ${T.border}`, color:T.textMuted }}>CANCEL</button>
              </div>
            </div>
          )}

          {tab === 'sections' && (
            <FogSectionsPanel sections={fogSections} sessionId={sessionId} dispatch={dispatch} toggleSection={toggleSection} deleteSection={deleteSection} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Fog Sections Panel ─────────────────────────────────────────────────────

function FogSectionsPanel({ sections, sessionId, dispatch, toggleSection, deleteSection }: {
  sections:       import('./types').FogSection[];
  sessionId:      string;
  dispatch:       (a: Action) => void;
  toggleSection:  (sec: import('./types').FogSection) => void;
  deleteSection:  (id: string) => void;
}) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
      <div style={{ fontSize: '13px', color:T.textMuted, lineHeight:'1.5' }}>
        Manage fog layers here. Use the <span style={{ color:T.rp }}>FOG</span> toolbar button to paint on a layer in the session.
      </div>
      {sections.length === 0 && <div style={{ fontSize: '13px', color:T.textDim, textAlign:'center', padding:'12px 0' }}>No layers defined yet.</div>}
      {sections.map(sec => (
        <div key={sec.id} style={{ display:'flex', alignItems:'center', gap:'8px', background:T.surface, borderRadius:'4px', padding:'8px 10px', border:`1px solid ${sec.is_hidden ? T.hp+'44' : T.border}` }}>
          <button onClick={() => toggleSection(sec)} title={sec.is_hidden ? 'Click to reveal' : 'Click to hide'} style={{ background:'transparent', border:'none', cursor:'pointer', fontSize: '17px', lineHeight:1, color: sec.is_hidden ? T.hp : T.green }}>
            {sec.is_hidden ? '🌑' : '👁'}
          </button>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize: '14px', color: sec.is_hidden ? T.hp : T.text, letterSpacing:'0.08em' }}>{sec.name}</div>
            <div style={{ fontSize: '12px', color:T.textDim }}>{sec.is_hidden ? 'HIDDEN' : 'VISIBLE'}</div>
          </div>
          <button onClick={() => deleteSection(sec.id)} title="Delete layer" style={{ background:'transparent', border:'none', cursor:'pointer', fontSize: '15px', color:T.textDim }}>x</button>
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
    const match = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    const results: number[] = [];
    if (match) {
      const count = parseInt(match[1]), sides = parseInt(match[2]);
      for (let i=0; i<count; i++) results.push(Math.floor(Math.random()*sides)+1);
    }
    const total = results.reduce((s,n)=>s+n,0) + parseInt(formula.match(/[+-]\d+$/)?.[0]??'0');
    socket.rollAttack({ source_label:`${enemy.name} - ${atkName}`, formula, results, total, damage_type: dmgType, visibility: rollVis });
  };

  const sortBtn = (key: SortKey, lbl: string) => (
    <button onClick={() => toggleSort(key)}
      style={{ background: sortKey===key ? T.gold+'18' : 'transparent', border:`1px solid ${sortKey===key ? T.gold : T.border}`, borderRadius:'2px', padding:'3px 8px', cursor:'pointer', color: sortKey===key ? T.gold : T.textMuted, fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.12em', display:'flex', alignItems:'center', gap:'3px' }}>
      {lbl} {sortKey===key ? (sortDir==='asc' ? 'up' : 'dn') : ''}
    </button>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={onClose}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px', width:'520px', maxWidth:'92vw', height:'78vh', display:'flex', flexDirection:'column', overflow:'hidden' }} onClick={e => e.stopPropagation()}>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 20px', borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <span style={{ fontFamily:"'Cinzel',serif", fontSize: '16px', letterSpacing:'0.14em', color:T.text }}>PLACE TOKEN</span>
          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
            <span style={{ fontSize: '13px', color:T.textDim }}>Roll visibility:</span>
            {(['public','dm'] as const).map(v => (
              <button key={v} onClick={() => setRollVis(v)}
                style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.1em', padding:'2px 8px', borderRadius:'2px', cursor:'pointer', background: rollVis===v ? T.gold+'18' : 'transparent', border:`1px solid ${rollVis===v ? T.gold : T.border}`, color: rollVis===v ? T.gold : T.textDim }}>
                {v.toUpperCase()}
              </button>
            ))}
            <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize: '21px', lineHeight:1, marginLeft:'4px' }}>x</button>
          </div>
        </div>

        <div style={{ padding:'10px 16px', borderBottom:`1px solid ${T.border}`, flexShrink:0, display:'flex', flexDirection:'column', gap:'8px' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search enemies..." autoFocus style={inputSt} />
          <div style={{ display:'flex', gap:'4px', alignItems:'center' }}>
            <span style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.14em', color:T.textDim, marginRight:'4px' }}>SORT:</span>
            {sortBtn('name', 'NAME')}
            {sortBtn('classification', 'CLASS')}
            {sortBtn('hp', 'HP')}
          </div>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'8px 12px', display:'flex', flexDirection:'column', gap:'4px' }}>
          {enemies.length === 0 && <div style={{ textAlign:'center', padding:'24px 0', color:T.textDim, fontFamily:"'Cinzel',serif", fontSize: '14px', letterSpacing:'0.14em' }}>NO ENEMIES FOUND</div>}
          {enemies.map(enemy => {
            const isExpanded = expanded === enemy.id;
            const isPlacing  = placing?.id === enemy.id;
            return (
              <div key={enemy.id} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:'4px', overflow:'hidden' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', padding:'8px 12px' }}>
                  <div style={{ flex:1, cursor:'pointer', minWidth:0 }} onClick={() => setExpanded(isExpanded ? null : enemy.id)}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <span style={{ fontFamily:"'Cinzel',serif", fontSize: '15px', color:T.text, letterSpacing:'0.08em' }}>{enemy.name}</span>
                      <span style={{ fontSize: '12px', color: CLASS_COLOR[enemy.classification]??T.textMuted, textTransform:'uppercase', letterSpacing:'0.12em' }}>{enemy.classification}</span>
                      <span style={{ fontSize: '12px', color:T.textDim, marginLeft:'auto' }}>HP {enemy.hp}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: '13px', color:T.textDim, cursor:'pointer', flexShrink:0 }} onClick={() => setExpanded(isExpanded ? null : enemy.id)}>{isExpanded ? 'v' : '>'}</span>
                  <button onClick={e => { e.stopPropagation(); setPlacing(enemy); setLabel(enemy.name); }}
                    style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.1em', padding:'4px 10px', borderRadius:'2px', cursor:'pointer', background:T.gold+'18', border:`1px solid ${T.gold}44`, color:T.gold, flexShrink:0 }}>
                    + ADD
                  </button>
                </div>

                {isExpanded && (
                  <div style={{ padding:'0 12px 12px', borderTop:`1px solid ${T.border}` }}>
                    <div style={{ display:'flex', gap:'12px', padding:'8px 0 6px', flexWrap:'wrap' }}>
                      {([['POW',enemy.power],['AGI',enemy.agility],['FOC',enemy.focus],['PRE',enemy.presence]] as [string,number][]).map(([k,v]) => (
                        <div key={k} style={{ textAlign:'center' }}>
                          <div style={{ fontSize: '12px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>{k}</div>
                          <div style={{ fontSize: '16px', color:T.text, fontWeight:700 }}>{v}</div>
                          <div style={{ fontSize: '12px', color:T.textMuted }}>{v>=10?'+':''}{Math.floor((v-10)/2)}</div>
                        </div>
                      ))}
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize: '12px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>HP</div>
                        <div style={{ fontSize: '16px', color:T.hp, fontWeight:700 }}>{enemy.hp}</div>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize: '12px', color:T.textDim, fontFamily:"'Cinzel',serif", letterSpacing:'0.1em' }}>BASE RP</div>
                        <div style={{ fontSize: '16px', color:T.rp, fontWeight:700 }}>{enemy.base_rp}</div>
                      </div>
                    </div>
                    {enemy.attacks.length > 0 && (
                      <>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.14em', color:T.textDim, margin:'6px 0 4px' }}>ATTACKS</div>
                        {enemy.attacks.map((atk, i) => (
                          <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:T.card, borderRadius:'2px', padding:'5px 8px', marginBottom:'3px' }}>
                            <div>
                              <span style={{ fontSize: '14px', color:T.text }}>{atk.name}</span>
                              <span style={{ fontSize: '12px', color:T.textMuted, marginLeft:'8px' }}>{atk.damage_dice} {atk.damage_type}</span>
                            </div>
                            <button onClick={() => rollAttack(enemy, atk.name, atk.damage_dice, atk.damage_type)}
                              style={{ background:T.hp+'18', border:`1px solid ${T.hp}44`, borderRadius:'2px', padding:'2px 8px', cursor:'pointer', color:T.hp, fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.1em' }}>
                              ROLL
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                    {enemy.traits.length > 0 && (
                      <>
                        <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.14em', color:T.textDim, margin:'8px 0 4px' }}>TRAITS</div>
                        {enemy.traits.map((trait, i) => (
                          <div key={i} style={{ fontSize: '13px', color:T.textMuted, marginBottom:'4px', lineHeight:'1.5' }}>
                            <span style={{ color:T.text, fontFamily:"'Cinzel',serif" }}>{trait.name}:</span> {trait.description}
                          </div>
                        ))}
                      </>
                    )}
                    {enemy.description && <div style={{ fontSize: '13px', color:T.textDim, marginTop:'8px', lineHeight:'1.6', fontStyle:'italic' }}>{enemy.description}</div>}
                  </div>
                )}

                {isPlacing && (
                  <div style={{ padding:'8px 12px', background:T.card, borderTop:`1px solid ${T.border}`, display:'flex', gap:'8px', alignItems:'center' }}>
                    <input value={label} onChange={e => setLabel(e.target.value)} autoFocus onKeyDown={e => e.key==='Enter' && placeToken(enemy)} placeholder="Label (e.g. Goblin A)" style={{ ...inputSt, flex:1 }} />
                    <button onClick={() => { setPlacing(null); setLabel(''); }} style={{ background:'transparent', border:`1px solid ${T.border}`, borderRadius:'2px', padding:'6px 10px', cursor:'pointer', color:T.textMuted, fontFamily:"'Cinzel',serif", fontSize: '12px' }}>CANCEL</button>
                    <button onClick={() => placeToken(enemy)} disabled={submitting} style={{ background:T.gold+'22', border:`1px solid ${T.gold}`, borderRadius:'2px', padding:'6px 14px', cursor: submitting ? 'not-allowed' : 'pointer', color:T.gold, fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.1em' }}>{submitting ? 'PLACING...' : 'PLACE'}</button>
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
      <div style={{ fontFamily:"'Cinzel',serif", fontSize: '12px', letterSpacing:'0.18em', color:T.textDim, marginBottom:'6px' }}>{label}</div>
      {children}
    </div>
  );
}

const inputSt: React.CSSProperties = {
  background: T.surface, border: `1px solid ${T.border}`, borderRadius: '2px',
  padding: '7px 10px', color: T.text, fontSize: '15px', outline: 'none',
  width: '100%', boxSizing: 'border-box',
};