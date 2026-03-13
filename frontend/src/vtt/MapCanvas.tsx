import React from 'react';
/**
 * MapCanvas.tsx — Layered VTT map canvas
 *
 * Layer order (bottom to top):
 *   1. Map image
 *   2. Grid (clipped to map bounds)
 *   3. Fog of war (default = revealed; only explicitly hidden cells are dark)
 *   4. Canvas shapes + transform handles
 *   5. Tokens (with hidden tint for DM view)
 *   6. Ruler
 *
 * Move tool:  'select' = interact with assets;  'pan' = drag viewport
 * Fog:        circle / square / flood-fill brush; brush center is freeform
 * Shapes:     click to select, drag center to move, drag corners to scale
 * Tokens:     click to select; shift+click to multi-select / group
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type {
  VTTMap, MapToken, EnemyInstance, CanvasShape, FogSection,
  RulerState, ToolMode, FogBrushShape, EnemyStatBlock,
} from './types';
import { Action } from './useVTTState';
import { api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

// ── Theme ──────────────────────────────────────────────────────────────────
const T = {
  bg:        '#080b10',
  border:    '#1c2230',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  textDim:   '#504538',
  gold:      '#c4922a',
  hp:        '#d45c5c',
  rp:        '#3ab5e8',
  green:     '#50a060',
  grid:      'rgba(255,255,255,0.07)',
  surface:   '#0d1018',
  card:      '#111520',
};

// ── Props ──────────────────────────────────────────────────────────────────
interface Props {
  map:             VTTMap;
  tokens:          MapToken[];
  enemyInstances:  EnemyInstance[];
  fogCells:        Map<string, boolean>;
  fogSections:     FogSection[];
  shapes:          CanvasShape[];
  rulers:          Map<string, RulerState>;
  isDM:            boolean;
  activeTool:      ToolMode;
  toolColor:       string;
  fogBrushSize:    number;
  fogBrushShape:   FogBrushShape;
  userId:          string;
  sessionId:       string;
  socket: {
    moveToken:            (id: string, x: number, y: number) => void;
    updateFog:            (cells: Array<{ x: number; y: number; revealed: boolean }>) => void;
    addShape:             (shape: unknown) => void;
    removeShape:          (id: string) => void;
    updateShape:          (shape: unknown) => void;
    updateToken:          (token: unknown) => void;
    updateRuler:          (s: { x: number; y: number }, e: { x: number; y: number }) => void;
    clearRuler:           () => void;
    broadcastTokenPlaced: (token: unknown) => void;
  };
  dispatch: (action: Action) => void;
}

// ── Handle types ───────────────────────────────────────────────────────────
type HandleType = 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'scale-r' | 'ep1' | 'ep2';
interface TransformRef {
  shapeId:      string;
  handleType:   HandleType;
  startCanvas:  { x: number; y: number };
  originalData: Record<string, number>;
}
interface HandleDef { x: number; y: number; type: HandleType; }

const HANDLE_R   = 7;
const HANDLE_HIT = 12;

// ── Helpers ────────────────────────────────────────────────────────────────
const fogKey = (x: number, y: number) => `${x},${y}`;

const toCell = (cx: number, cy: number, px: number, py: number, z: number, cs: number) => ({
  x: Math.floor((cx - px) / (cs * z)),
  y: Math.floor((cy - py) / (cs * z)),
});

const cellCentre = (gx: number, gy: number, px: number, py: number, z: number, cs: number) => ({
  x: px + (gx + 0.5) * cs * z,
  y: py + (gy + 0.5) * cs * z,
});

const cellDist = (ax: number, ay: number, bx: number, by: number) =>
  Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);

const gridToCanvas = (gx: number, gy: number, px: number, py: number, z: number, cs: number) => ({
  x: px + gx * cs * z,
  y: py + gy * cs * z,
});

// ── Image cache ────────────────────────────────────────────────────────────
const imgCache = new Map<string, HTMLImageElement>();
function loadImage(src: string): Promise<HTMLImageElement> {
  if (imgCache.has(src)) return Promise.resolve(imgCache.get(src)!);
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { imgCache.set(src, img); res(img); };
    img.onerror = rej;
    img.src = src;
  });
}

// ── Button style helper ────────────────────────────────────────────────────
const btnSt = (bg: string, col: string): React.CSSProperties => ({
  background: bg, color: col, border: `1px solid ${col}33`,
  borderRadius: '2px', padding: '3px 8px', cursor: 'pointer',
  fontFamily: "'Cinzel',serif", fontSize: '9px', letterSpacing: '0.1em',
});

const miniInputSt: React.CSSProperties = {
  background: '#0d1018', border: '1px solid #1c2230', borderRadius: '2px',
  padding: '4px 8px', color: '#e4d8c0', fontSize: '11px', outline: 'none',
};

// ── Component ──────────────────────────────────────────────────────────────
export default function MapCanvas(props: Props) {
  const {
    map, tokens, enemyInstances, fogCells, fogSections, shapes, rulers,
    isDM, activeTool, toolColor, fogBrushSize, fogBrushShape,
    userId, sessionId, socket, dispatch,
  } = props;

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const panX = useRef(0), panY = useRef(0), zoom = useRef(1);
  const isPanning  = useRef(false);
  const panStart   = useRef({ x: 0, y: 0 });

  // Section creation accumulator
  const [sectionCells,  setSectionCells]  = useState<Array<{x:number;y:number}>>([]);
  const [sectionName,   setSectionName]   = useState('');
  const [sectionSaving, setSectionSaving] = useState(false);
  const sectionRef = useRef<Array<{x:number;y:number}>>([]); // sync ref for event handlers

  const draggingToken    = useRef<MapToken | null>(null);
  const draggingGroup    = useRef<MapToken[]>([]);
  const dragCanvasPos    = useRef({ x: 0, y: 0 });
  const dragGroupOffsets = useRef<Array<{ id: string; dx: number; dy: number }>>([]);

  const toolStart   = useRef<{ x: number; y: number } | null>(null);
  const toolCurrent = useRef<{ x: number; y: number } | null>(null);
  const isTooling   = useRef(false);

  const transforming = useRef<TransformRef | null>(null);
  const [transformPreview, setTransformPreview] = useState<{ shapeId: string; data: Record<string, number> } | null>(null);

  const [selectedShapeId,   setSelectedShapeId]  = useState<string | null>(null);
  const [selectedTokenIds,  setSelectedTokenIds] = useState<Set<string>>(new Set());
  const [tokenPanelId,      setTokenPanelId]     = useState<string | null>(null);
  const tokenPanelRef = useRef<HTMLDivElement>(null);
  const [renaming,    setRenaming]    = useState<{ tokenId: string; label: string } | null>(null);
  const [showStatBlock,   setShowStatBlock]   = useState<string | null>(null);
  const [encounterToast,  setEncounterToast]  = useState<string | null>(null);

  const [localRuler, setLocalRuler] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);

  const mapImgRef  = useRef<HTMLImageElement | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    loadImage(map.image_url).then(img => {
      mapImgRef.current = img;
      setMapLoaded(true);
      const c = containerRef.current;
      if (c) {
        const s = Math.min(c.clientWidth / img.width, c.clientHeight / img.height, 1);
        zoom.current = s;
        panX.current = (c.clientWidth  - img.width  * s) / 2;
        panY.current = (c.clientHeight - img.height * s) / 2;
      }
    }).catch(console.error);
  }, [map.image_url]);

  // Merge transform preview into shapes
  const activeShapes = shapes.map(s =>
    transformPreview?.shapeId === s.id
      ? { ...s, data: { ...s.data, ...transformPreview.data } }
      : s
  );

  // ── Draw ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx)  return;
    const W = canvas.width, H = canvas.height;
    const z = zoom.current, px = panX.current, py = panY.current;
    const cs = map.grid_cell_size, cz = cs * z;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = T.bg;
    ctx.fillRect(0, 0, W, H);

    const mapImg = mapImgRef.current;
    const mapW = mapImg ? mapImg.width * z : map.width_cells * cz;
    const mapH = mapImg ? mapImg.height * z : map.height_cells * cz;

    if (mapImg) ctx.drawImage(mapImg, px, py, mapW, mapH);

    // Map border
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 24;
    ctx.strokeStyle = T.border; ctx.lineWidth = 2;
    ctx.strokeRect(px, py, mapW, mapH);
    ctx.restore();

    // ── Grid (clipped to map) ─────────────────────────────────────────
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, mapW, mapH); ctx.clip();
    ctx.strokeStyle = T.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    const sc = Math.max(0, Math.floor((0 - px) / cz));
    const sr = Math.max(0, Math.floor((0 - py) / cz));
    const ec = Math.min(map.width_cells,  Math.ceil((W - px) / cz));
    const er = Math.min(map.height_cells, Math.ceil((H - py) / cz));
    for (let col = sc; col <= ec; col++) { const x = px + col * cz; ctx.moveTo(x, py); ctx.lineTo(x, py + map.height_cells * cz); }
    for (let row = sr; row <= er; row++) { const y = py + row * cz; ctx.moveTo(px, y); ctx.lineTo(px + map.width_cells * cz, y); }
    ctx.stroke();
    ctx.restore();

    // ── Fog ───────────────────────────────────────────────────────────
    // Default = revealed. No DB entry → cell is visible.
    const fogAlpha = isDM ? 0.5 : 1.0;
    const sectionHiddenCells = new Set<string>();
    for (const sec of fogSections) {
      if (sec.is_hidden) for (const c of sec.cells) sectionHiddenCells.add(fogKey(c.x, c.y));
    }
    for (let col = sc; col < ec; col++) {
      for (let row = sr; row < er; row++) {
        const key = fogKey(col, row);
        if ((fogCells.get(key) ?? true) === false || sectionHiddenCells.has(key)) {
          ctx.fillStyle = `rgba(0,0,0,${fogAlpha})`;
          ctx.fillRect(px + col * cz, py + row * cz, cz, cz);
        }
      }
    }
    if (activeTool === 'fog_section' && sectionRef.current.length > 0) {
      ctx.fillStyle = 'rgba(100,180,255,0.35)';
      ctx.strokeStyle = 'rgba(100,180,255,0.9)'; ctx.lineWidth = 1;
      for (const c of sectionRef.current) {
        ctx.fillRect(px + c.x * cz, py + c.y * cz, cz, cz);
        ctx.strokeRect(px + c.x * cz, py + c.y * cz, cz, cz);
      }
    }

    // ── Shapes ────────────────────────────────────────────────────────
    for (const s of activeShapes) drawShape(ctx, s, px, py, z, cz, s.id === selectedShapeId);
    if (selectedShapeId && activeTool === 'select') {
      const sel = activeShapes.find(s => s.id === selectedShapeId);
      if (sel) drawShapeHandles(ctx, sel, px, py, z, cs);
    }

    // Tool preview
    if (isTooling.current && toolStart.current && toolCurrent.current && isDM) {
      drawToolPreview(ctx, activeTool, toolColor, toolStart.current, toolCurrent.current, px, py, z, cz);
    }

    // ── Tokens ────────────────────────────────────────────────────────
    for (const token of tokens) {
      if (token.is_hidden && !isDM) continue;
      if (!isDM && !(fogCells.get(fogKey(token.cell_x, token.cell_y)) ?? true)) continue;

      const isDrag  = draggingToken.current?.id === token.id;
      const isGDrag = draggingGroup.current.some(t => t.id === token.id);
      let cx: number, cy: number;
      if (isDrag) {
        cx = dragCanvasPos.current.x; cy = dragCanvasPos.current.y;
      } else if (isGDrag) {
        const off = dragGroupOffsets.current.find(o => o.id === token.id);
        cx = dragCanvasPos.current.x + (off?.dx ?? 0) * cz;
        cy = dragCanvasPos.current.y + (off?.dy ?? 0) * cz;
      } else {
        const c = cellCentre(token.cell_x, token.cell_y, px, py, z, cs);
        cx = c.x; cy = c.y;
      }

      const isEnemy  = token.entity_type === 'enemy';
      const inst     = isEnemy ? enemyInstances.find(e => e.id === token.entity_id) : null;
      const sc2      = token.scale ?? 1;
      const radius   = cz * 0.42 * sc2;
      const isSel    = selectedTokenIds.has(token.id);

      ctx.save();
      if (token.is_hidden) ctx.globalAlpha = 0.4;

      if (isSel) {
        ctx.beginPath(); ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = T.gold; ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
      }

      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = isEnemy ? '#2a0a0a' : '#0a1a2a'; ctx.fill();
      ctx.strokeStyle = isEnemy ? T.hp : T.rp; ctx.lineWidth = 2; ctx.stroke();

      if (token.token_url) {
        const img = imgCache.get(token.token_url);
        if (img) {
          ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2); ctx.clip();
          ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2); ctx.restore();
        } else { loadImage(token.token_url).then(() => draw()); }
      }

      const lbl = token.label ?? inst?.label ?? '?';
      ctx.fillStyle = T.text; ctx.font = `bold ${Math.max(9, cz * 0.22 * sc2)}px 'Inter',sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(lbl.slice(0, 3).toUpperCase(), cx, cy);

      if (token.is_hidden && isDM) {
        ctx.font = `${Math.max(8, cz * 0.18)}px sans-serif`;
        ctx.textBaseline = 'top'; ctx.fillStyle = T.gold;
        ctx.fillText('👁', cx, cy + radius + 2);
      }

      if (isDM && inst) {
        const hpPct = Math.max(0, Number(inst.current_hp) / Number(inst.max_hp));
        const bw = radius * 2, bh = Math.max(4, cz * 0.1);
        const bx = cx - radius, by = cy + radius + 3;
        ctx.fillStyle = '#1a0505'; ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = hpPct > 0.5 ? T.green : hpPct > 0.25 ? T.gold : T.hp;
        ctx.fillRect(bx, by, bw * hpPct, bh);
      }

      if (inst?.is_defeated) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = T.hp; ctx.font = `${cz * 0.4}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✕', cx, cy);
      }

      // Group indicator dot
      if (token.group_id) {
        ctx.beginPath(); ctx.arc(cx + radius * 0.7, cy - radius * 0.7, 3, 0, Math.PI * 2);
        ctx.fillStyle = T.rp; ctx.fill();
      }

      ctx.restore();
    }

    // ── Rulers ────────────────────────────────────────────────────────
    const fpc = map.feet_per_cell ?? 5;
    for (const [, r] of rulers) drawRuler(ctx, r.start, r.end, px, py, z, cs, T.rp + '99', fpc);
    if (localRuler) drawRuler(ctx, localRuler.start, localRuler.end, px, py, z, cs, T.gold, fpc);

    // ── Fog brush preview ─────────────────────────────────────────────
    if (isDM && (activeTool === 'fog_reveal' || activeTool === 'fog_hide') && toolCurrent.current) {
      const pos = toolCurrent.current;
      const col = activeTool === 'fog_reveal' ? T.green + 'cc' : T.hp + 'cc';
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      if (fogBrushShape === 'fill') {
        const cell = toCell(pos.x, pos.y, px, py, z, cs);
        ctx.strokeRect(px + cell.x * cz, py + cell.y * cz, cz, cz);
      } else if (fogBrushShape === 'circle') {
        const rPx = (fogBrushSize + 0.5) * cz;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, rPx, 0, Math.PI * 2); ctx.stroke();
      } else {
        const cell = toCell(pos.x, pos.y, px, py, z, cs);
        const r = fogBrushSize;
        ctx.strokeRect(px + (cell.x - r) * cz, py + (cell.y - r) * cz, (r * 2 + 1) * cz, (r * 2 + 1) * cz);
      }
      ctx.setLineDash([]);
    }

    // Imperatively position token panel
    if (tokenPanelId && tokenPanelRef.current) {
      const t = tokens.find(tok => tok.id === tokenPanelId);
      if (t) {
        const sc2 = t.scale ?? 1;
        const r   = cz * 0.42 * sc2;
        const c   = cellCentre(t.cell_x, t.cell_y, px, py, z, cs);
        tokenPanelRef.current.style.left = `${c.x}px`;
        tokenPanelRef.current.style.top  = `${c.y - r - 10}px`;
      }
    }
  }, [
    map, tokens, enemyInstances, fogCells, fogSections, activeShapes, shapes, rulers,
    isDM, activeTool, toolColor, fogBrushSize, fogBrushShape,
    localRuler, mapLoaded, selectedShapeId, selectedTokenIds,
    transformPreview, tokenPanelId, sectionCells,
  ]);

  // ── Resize ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current, cont = containerRef.current;
    if (!canvas || !cont) return;
    const ro = new ResizeObserver(() => { canvas.width = cont.clientWidth; canvas.height = cont.clientHeight; draw(); });
    ro.observe(cont);
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // ── Helpers ───────────────────────────────────────────────────────────
  const getCanvasPos = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitToken = (cx: number, cy: number): MapToken | null => {
    for (const t of [...tokens].reverse()) {
      if (t.is_hidden && !isDM) continue;
      const c = cellCentre(t.cell_x, t.cell_y, panX.current, panY.current, zoom.current, map.grid_cell_size);
      const r = map.grid_cell_size * zoom.current * 0.42 * (t.scale ?? 1);
      if ((cx - c.x) ** 2 + (cy - c.y) ** 2 <= r * r) return t;
    }
    return null;
  };

  const hitHandle = (cx: number, cy: number): { shapeId: string; handleType: HandleType } | null => {
    if (!selectedShapeId || activeTool !== 'select') return null;
    const shape = activeShapes.find(s => s.id === selectedShapeId);
    if (!shape) return null;
    for (const h of getShapeHandles(shape, panX.current, panY.current, zoom.current, map.grid_cell_size)) {
      if ((cx - h.x) ** 2 + (cy - h.y) ** 2 <= HANDLE_HIT * HANDLE_HIT) return { shapeId: shape.id, handleType: h.type };
    }
    return null;
  };

  // ── Events ────────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const cs  = map.grid_cell_size;

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning.current = true;
      panStart.current  = { x: e.clientX - panX.current, y: e.clientY - panY.current };
      return;
    }
    if (e.button !== 0) return;

    if (activeTool === 'pan') {
      isPanning.current = true;
      panStart.current  = { x: e.clientX - panX.current, y: e.clientY - panY.current };
      return;
    }

    if (activeTool === 'select') {
      // Handles first
      const h = hitHandle(pos.x, pos.y);
      if (h) {
        const shape = activeShapes.find(s => s.id === h.shapeId)!;
        transforming.current = { shapeId: h.shapeId, handleType: h.handleType, startCanvas: pos, originalData: { ...(shape.data as Record<string, number>) } };
        return;
      }
      // Token
      const token = hitToken(pos.x, pos.y);
      if (token) {
        if (e.shiftKey) {
          setSelectedTokenIds(prev => { const n = new Set(prev); n.has(token.id) ? n.delete(token.id) : n.add(token.id); return n; });
        } else {
          setSelectedTokenIds(new Set([token.id]));
          setTokenPanelId(token.id);
          setSelectedShapeId(null);
        }
        draggingToken.current = token;
        dragCanvasPos.current = pos;
        if (token.group_id) {
          const members = tokens.filter(t => t.group_id === token.group_id && t.id !== token.id);
          draggingGroup.current = members;
          const lc = cellCentre(token.cell_x, token.cell_y, panX.current, panY.current, zoom.current, cs);
          dragGroupOffsets.current = members.map(t => {
            const mc = cellCentre(t.cell_x, t.cell_y, panX.current, panY.current, zoom.current, cs);
            return { id: t.id, dx: (mc.x - lc.x) / (cs * zoom.current), dy: (mc.y - lc.y) / (cs * zoom.current) };
          });
        } else {
          draggingGroup.current = []; dragGroupOffsets.current = [];
        }
        return;
      }
      // Shape body
      const hit = hitTestShape(pos.x, pos.y, activeShapes, panX.current, panY.current, zoom.current, cs);
      if (hit) {
        setSelectedShapeId(hit.id); setSelectedTokenIds(new Set()); setTokenPanelId(null);
        transforming.current = { shapeId: hit.id, handleType: 'move', startCanvas: pos, originalData: { ...(hit.data as Record<string, number>) } };
        return;
      }
      setSelectedShapeId(null); setSelectedTokenIds(new Set()); setTokenPanelId(null);
      return;
    }

    if (activeTool === 'ruler') {
      const cell = toCell(pos.x, pos.y, panX.current, panY.current, zoom.current, cs);
      toolStart.current = cell; toolCurrent.current = cell; isTooling.current = true;
      return;
    }

    if (activeTool === 'fog_reveal' || activeTool === 'fog_hide') {
      isTooling.current = true; toolCurrent.current = pos;
      if (fogBrushShape === 'fill') applyFogFill(pos); else applyFogAt(pos);
      return;
    }

    if (activeTool === 'fog_section') {
      isTooling.current = true; toolCurrent.current = pos;
      paintSectionCell(pos);
      return;
    }

    if (['marker', 'circle', 'rect', 'line', 'cone'].includes(activeTool)) {
      toolStart.current = pos; toolCurrent.current = pos; isTooling.current = true;
      setSelectedShapeId(null);
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);

    if (isPanning.current) {
      panX.current = e.clientX - panStart.current.x;
      panY.current = e.clientY - panStart.current.y;
      draw(); return;
    }
    if (draggingToken.current) {
      dragCanvasPos.current = pos; draw(); return;
    }
    if (transforming.current) {
      const t  = transforming.current;
      const cz = map.grid_cell_size * zoom.current;
      const dx = (pos.x - t.startCanvas.x) / cz;
      const dy = (pos.y - t.startCanvas.y) / cz;
      setTransformPreview({ shapeId: t.shapeId, data: applyTransform(t.handleType, t.originalData, dx, dy) });
      draw(); return;
    }

    toolCurrent.current = pos;

    if (activeTool === 'ruler' && isTooling.current && toolStart.current) {
      const cell = toCell(pos.x, pos.y, panX.current, panY.current, zoom.current, map.grid_cell_size);
      setLocalRuler({ start: toolStart.current, end: cell });
      socket.updateRuler(toolStart.current, cell);
    }
    if ((activeTool === 'fog_reveal' || activeTool === 'fog_hide') && isTooling.current && fogBrushShape !== 'fill') {
      applyFogAt(pos);
    }
    if (activeTool === 'fog_section' && isTooling.current) {
      paintSectionCell(pos);
    }
    draw();
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const pos = getCanvasPos(e);
    const cs  = map.grid_cell_size;
    isPanning.current = false;

    if (draggingToken.current) {
      const token = draggingToken.current;
      const cell  = toCell(pos.x, pos.y, panX.current, panY.current, zoom.current, cs);
      const cx    = Math.max(0, Math.min(map.width_cells  - 1, cell.x));
      const cy    = Math.max(0, Math.min(map.height_cells - 1, cell.y));
      socket.moveToken(token.id, cx, cy);
      dispatch({ type: 'TOKEN_MOVED', token_id: token.id, cell_x: cx, cell_y: cy });
      for (const off of dragGroupOffsets.current) {
        const gx = Math.max(0, Math.min(map.width_cells  - 1, cx + Math.round(off.dx)));
        const gy = Math.max(0, Math.min(map.height_cells - 1, cy + Math.round(off.dy)));
        socket.moveToken(off.id, gx, gy);
        dispatch({ type: 'TOKEN_MOVED', token_id: off.id, cell_x: gx, cell_y: gy });
      }
      draggingToken.current = null; draggingGroup.current = []; dragGroupOffsets.current = [];
      draw(); return;
    }

    if (transforming.current && transformPreview) {
      const { shapeId, data } = transformPreview;
      api.patch(`/vtt/sessions/${sessionId}/shapes/${shapeId}`, { data })
        .then(r => { dispatch({ type: 'SHAPE_UPDATED', shape: r.data }); socket.updateShape(r.data); })
        .catch(console.error);
      transforming.current = null; setTransformPreview(null); draw(); return;
    }
    transforming.current = null; setTransformPreview(null);

    if (activeTool === 'ruler' && isTooling.current) {
      isTooling.current = false; setLocalRuler(null); socket.clearRuler(); draw(); return;
    }
    if ((activeTool === 'fog_reveal' || activeTool === 'fog_hide') && isTooling.current) {
      isTooling.current = false; return;
    }
    if (activeTool === 'fog_section' && isTooling.current) {
      isTooling.current = false; draw(); return;
    }
    if (['marker', 'circle', 'rect', 'line', 'cone'].includes(activeTool) && isTooling.current && toolStart.current) {
      isTooling.current = false;
      const data = buildShapeData(activeTool as any, toolStart.current, pos, panX.current, panY.current, zoom.current, cs);
      api.post(`/vtt/sessions/${sessionId}/shapes`, { shape_type: activeTool, color: toolColor, data })
        .then(r => { dispatch({ type: 'SHAPE_ADDED', shape: r.data }); socket.addShape(r.data); })
        .catch(console.error);
      toolStart.current = null; toolCurrent.current = null; draw();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const pos = getCanvasPos(e);
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZ   = Math.max(0.15, Math.min(5, zoom.current * factor));
    panX.current = pos.x - (pos.x - panX.current) * (newZ / zoom.current);
    panY.current = pos.y - (pos.y - panY.current) * (newZ / zoom.current);
    zoom.current = newZ;
    draw();
  };

  const onMouseLeave = () => {
    if (activeTool === 'ruler' && isTooling.current) {
      isTooling.current = false; setLocalRuler(null); socket.clearRuler();
    }
    isPanning.current = false; draggingToken.current = null; draggingGroup.current = [];
    toolCurrent.current = null; transforming.current = null; setTransformPreview(null);
    draw();
  };

  // ── Fog section painting ─────────────────────────────────────────────────
  const paintSectionCell = (pos: { x: number; y: number }) => {
    const cell = toCell(pos.x, pos.y, panX.current, panY.current, zoom.current, map.grid_cell_size);
    if (cell.x < 0 || cell.x >= map.width_cells || cell.y < 0 || cell.y >= map.height_cells) return;
    const key = fogKey(cell.x, cell.y);
    if (sectionRef.current.some(c => fogKey(c.x, c.y) === key)) return; // already added
    const next = [...sectionRef.current, { x: cell.x, y: cell.y }];
    sectionRef.current = next;
    setSectionCells(next);
    draw();
  };

  const saveFogSection = async () => {
    if (!sectionRef.current.length || sectionSaving) return;
    setSectionSaving(true);
    try {
      const { data: section } = await api.post(`/vtt/sessions/${sessionId}/fog-sections`, {
        name:  sectionName.trim() || 'Section',
        cells: sectionRef.current,
      });
      dispatch({ type: 'FOG_SECTION_ADDED', section });
      sectionRef.current = [];
      setSectionCells([]);
      setSectionName('');
    } catch (e) { console.error(e); }
    setSectionSaving(false);
  };

  const cancelFogSection = () => {
    sectionRef.current = [];
    setSectionCells([]);
    setSectionName('');
  };

    // ── Fog helpers ───────────────────────────────────────────────────────
  const applyFogAt = useCallback((pos: { x: number; y: number }) => {
    const cs = map.grid_cell_size, z = zoom.current, px = panX.current, py = panY.current;
    const revealed = activeTool === 'fog_reveal';
    const r = fogBrushSize;
    const cells: Array<{ x: number; y: number; revealed: boolean }> = [];

    if (fogBrushShape === 'circle') {
      const rPx = (r + 0.5) * cs * z;
      const bR  = Math.ceil(r + 1);
      const base = toCell(pos.x, pos.y, px, py, z, cs);
      for (let dx = -bR; dx <= bR; dx++) {
        for (let dy = -bR; dy <= bR; dy++) {
          const cx = base.x + dx, cy = base.y + dy;
          if (cx < 0 || cx >= map.width_cells || cy < 0 || cy >= map.height_cells) continue;
          const ccx = px + (cx + 0.5) * cs * z;
          const ccy = py + (cy + 0.5) * cs * z;
          if ((ccx - pos.x) ** 2 + (ccy - pos.y) ** 2 <= rPx * rPx) cells.push({ x: cx, y: cy, revealed });
        }
      }
    } else {
      const cell = toCell(pos.x, pos.y, px, py, z, cs);
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const cx = cell.x + dx, cy = cell.y + dy;
          if (cx >= 0 && cx < map.width_cells && cy >= 0 && cy < map.height_cells) cells.push({ x: cx, y: cy, revealed });
        }
      }
    }

    if (!cells.length) return;
    socket.updateFog(cells);
    dispatch({ type: 'FOG_UPDATED', cells });
  }, [activeTool, fogBrushSize, fogBrushShape, map]);

  const applyFogFill = useCallback((pos: { x: number; y: number }) => {
    const cs = map.grid_cell_size;
    const start = toCell(pos.x, pos.y, panX.current, panY.current, zoom.current, cs);
    const targetState = fogCells.get(fogKey(start.x, start.y)) ?? true;
    const newState    = activeTool === 'fog_reveal';
    if (targetState === newState) return;
    const visited = new Set<string>(), queue = [start];
    const cells: Array<{ x: number; y: number; revealed: boolean }> = [];
    while (queue.length && cells.length < 5000) {
      const cell = queue.shift()!;
      const key  = fogKey(cell.x, cell.y);
      if (visited.has(key)) continue;
      if (cell.x < 0 || cell.x >= map.width_cells || cell.y < 0 || cell.y >= map.height_cells) continue;
      if ((fogCells.get(key) ?? true) !== targetState) continue;
      visited.add(key);
      cells.push({ x: cell.x, y: cell.y, revealed: newState });
      queue.push({ x: cell.x+1, y: cell.y }, { x: cell.x-1, y: cell.y }, { x: cell.x, y: cell.y+1 }, { x: cell.x, y: cell.y-1 });
    }
    socket.updateFog(cells);
    dispatch({ type: 'FOG_UPDATED', cells });
  }, [activeTool, fogCells, map]);

  // ── Token actions ─────────────────────────────────────────────────────
  const updateToken = (tokenId: string, changes: Record<string, unknown>) => {
    api.patch(`/vtt/sessions/${sessionId}/tokens/${tokenId}`, changes)
      .then(r => { dispatch({ type: 'TOKEN_UPDATED', token: r.data }); socket.updateToken(r.data); })
      .catch(console.error);
  };

  const deleteToken = (tokenId: string) => {
    api.delete(`/vtt/sessions/${sessionId}/tokens/${tokenId}`)
      .then(() => { dispatch({ type: 'TOKEN_REMOVED', token_id: tokenId }); setSelectedTokenIds(new Set()); setTokenPanelId(null); })
      .catch(console.error);
  };

  const deleteSelectedShape = () => {
    if (!selectedShapeId) return;
    api.delete(`/vtt/sessions/${sessionId}/shapes/${selectedShapeId}`)
      .then(() => { dispatch({ type: 'SHAPE_REMOVED', shape_id: selectedShapeId }); socket.removeShape(selectedShapeId); setSelectedShapeId(null); })
      .catch(console.error);
  };

  const groupSelected = () => {
    if (selectedTokenIds.size < 2) return;
    const gid = crypto.randomUUID();
    for (const id of selectedTokenIds) updateToken(id, { group_id: gid });
  };

  const ungroupToken = (tokenId: string) => {
    const t = tokens.find(x => x.id === tokenId);
    if (!t?.group_id) return;
    tokens.filter(x => x.group_id === t.group_id).forEach(m => updateToken(m.id, { group_id: null }));
  };

  const addToEncounter = (enemyInstanceId: string) => {
    api.post(`/vtt/sessions/${sessionId}/encounters/add-enemy`, { enemy_instance_id: enemyInstanceId })
      .then(r => {
        setEncounterToast(r.data.added ? 'Added to encounter!' : 'Already in encounter');
        setTimeout(() => setEncounterToast(null), 2500);
      })
      .catch(() => setEncounterToast('Failed to add'));
  };

  // ── Shape delete button position ──────────────────────────────────────
  const selShape = selectedShapeId ? shapes.find(s => s.id === selectedShapeId) : null;
  const getDelBtnPos = (): { x: number; y: number } | null => {
    if (!selShape) return null;
    const d = selShape.data as any, cz = map.grid_cell_size * zoom.current;
    switch (selShape.shape_type) {
      case 'marker': return { x: panX.current + d.cell_x * cz + cz / 2, y: panY.current + d.cell_y * cz - 8 };
      case 'circle': return { x: panX.current + d.cx * cz,              y: panY.current + (d.cy - d.r) * cz - 8 };
      case 'rect':   return { x: panX.current + (d.x + d.w/2) * cz,    y: panY.current + d.y * cz - 8 };
      case 'line':   return { x: panX.current + ((d.x1+d.x2)/2) * cz,  y: panY.current + ((d.y1+d.y2)/2) * cz - 8 };
      case 'cone':   return { x: panX.current + d.ex * cz,              y: panY.current + d.ey * cz - 8 };
      default: return null;
    }
  };
  const delBtnPos = getDelBtnPos();

  const panelToken = tokenPanelId ? tokens.find(t => t.id === tokenPanelId) : null;
  const panelInst  = panelToken?.entity_type === 'enemy' ? enemyInstances.find(e => e.id === panelToken.entity_id) : undefined;
  const panelSc    = panelToken?.scale ?? 1;

  const allSameGroup = selectedTokenIds.size > 1 && (() => {
    const ids = [...selectedTokenIds];
    const t0  = tokens.find(t => t.id === ids[0]);
    return ids.every(id => { const t = tokens.find(x => x.id === id); return t?.group_id && t.group_id === t0?.group_id; });
  })();

  const cursor = getCursor(activeTool, isPanning.current);

  return (
    <div ref={containerRef} style={{ width:'100%', height:'100%', position:'relative', cursor }}>
      <canvas
        ref={canvasRef} style={{ display:'block' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
        onWheel={onWheel} onMouseLeave={onMouseLeave} onContextMenu={e => e.preventDefault()}
      />

      {/* Shape action bar */}
      {selShape && delBtnPos && !transforming.current && (
        <div style={{ position:'absolute', left:delBtnPos.x, top:delBtnPos.y, transform:'translate(-50%,-100%)', display:'flex', gap:'4px', zIndex:20, pointerEvents:'auto' }}>
          <button onClick={deleteSelectedShape} style={btnSt('#c42a2a', T.text)}>DELETE</button>
          <button onClick={() => setSelectedShapeId(null)} style={btnSt(T.card, T.textMuted)}>✕</button>
        </div>
      )}

      {/* Token panel (DM only) */}
      {panelToken && isDM && (
        <div ref={tokenPanelRef} onMouseDown={e => e.stopPropagation()} style={{
          position:'absolute', transform:'translate(-50%,-100%)',
          background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px',
          padding:'10px 14px', minWidth:'180px', zIndex:30, pointerEvents:'auto',
          boxShadow:'0 4px 24px rgba(0,0,0,0.7)', display:'flex', flexDirection:'column', gap:'8px',
        }}>
          <button onClick={() => { setTokenPanelId(null); setSelectedTokenIds(new Set()); }}
            style={{ position:'absolute', top:'6px', right:'8px', background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize:'14px' }}>✕</button>

          {/* Label */}
          {renaming?.tokenId === panelToken.id ? (
            <div style={{ display:'flex', gap:'4px' }}>
              <input autoFocus value={renaming.label} onChange={e => setRenaming({ ...renaming, label: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') { updateToken(panelToken.id, { label: renaming.label }); setRenaming(null); } if (e.key === 'Escape') setRenaming(null); }}
                style={{ ...miniInputSt, flex:1 }} />
              <button onClick={() => { updateToken(panelToken.id, { label: renaming.label }); setRenaming(null); }} style={btnSt(T.gold+'22', T.gold)}>✓</button>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:'6px', cursor:'pointer' }} onClick={() => setRenaming({ tokenId: panelToken.id, label: panelToken.label ?? '' })}>
              <span style={{ fontFamily:"'Cinzel',serif", fontSize:'12px', color:T.gold, flex:1 }}>{panelToken.label ?? panelInst?.label ?? '—'}</span>
              <span style={{ fontSize:'10px', color:T.textDim }}>✎</span>
            </div>
          )}

          {panelInst && <div style={{ fontSize:'10px', color:T.textMuted }}>HP <span style={{ color:T.hp, fontWeight:700 }}>{Number(panelInst.current_hp)}</span>/{Number(panelInst.max_hp)}</div>}

          {/* Scale */}
          <div>
            <div style={{ fontFamily:"'Cinzel',serif", fontSize:'7px', letterSpacing:'0.16em', color:T.textDim, marginBottom:'4px' }}>SIZE</div>
            <div style={{ display:'flex', gap:'3px' }}>
              {([['S',0.7],['M',1.0],['L',1.5],['H',2.0]] as [string,number][]).map(([lbl,sc2]) => (
                <button key={lbl} onClick={() => updateToken(panelToken.id, { scale: sc2 })}
                  style={{ ...btnSt(panelSc === sc2 ? T.gold+'22' : 'transparent', panelSc === sc2 ? T.gold : T.textMuted), padding:'2px 6px', fontSize:'9px' }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ display:'flex', gap:'4px', flexWrap:'wrap' }}>
            <button onClick={() => updateToken(panelToken.id, { is_hidden: !panelToken.is_hidden })}
              style={btnSt(panelToken.is_hidden ? T.gold+'22' : 'transparent', panelToken.is_hidden ? T.gold : T.textMuted)}>
              {panelToken.is_hidden ? '👁 SHOW' : '🚫 HIDE'}
            </button>
            {panelToken.group_id && <button onClick={() => ungroupToken(panelToken.id)} style={btnSt('transparent', T.rp)}>UNGROUP</button>}
            {panelInst && <button onClick={() => setShowStatBlock(panelInst.enemy_id)} style={btnSt(T.rp+'18', T.rp)}>STATS</button>}
            {panelInst && <button onClick={() => addToEncounter(panelToken.entity_id)} style={btnSt(T.gold+'22', T.gold)}>+ ENCOUNTER</button>}
            <button onClick={() => deleteToken(panelToken.id)} style={btnSt(T.hp+'18', T.hp)}>DELETE</button>
          </div>
        </div>
      )}

      {/* Multi-select bar */}
      {selectedTokenIds.size > 1 && (
        <div style={{ position:'absolute', bottom:'16px', left:'50%', transform:'translateX(-50%)', background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px', padding:'8px 16px', display:'flex', alignItems:'center', gap:'12px', zIndex:20, pointerEvents:'auto', boxShadow:'0 4px 16px rgba(0,0,0,0.6)' }}>
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:'10px', color:T.textMuted }}>{selectedTokenIds.size} TOKENS</span>
          {!allSameGroup && <button onClick={groupSelected} style={btnSt(T.gold+'22', T.gold)}>GROUP</button>}
          {allSameGroup  && <button onClick={() => { const id = [...selectedTokenIds][0]; ungroupToken(id); }} style={btnSt(T.rp+'18', T.rp)}>UNGROUP</button>}
          <button onClick={() => { setSelectedTokenIds(new Set()); setTokenPanelId(null); }} style={btnSt('transparent', T.textMuted)}>✕</button>
        </div>
      )}

      {/* Stat block modal */}
      {showStatBlock && <StatBlockModal enemyId={showStatBlock} onClose={() => setShowStatBlock(null)} />}

      {/* Encounter toast */}
      {encounterToast && (
        <div style={{ position:'absolute', top:'16px', left:'50%', transform:'translateX(-50%)',
          background:T.card, border:`1px solid ${T.gold}44`, borderRadius:'6px', padding:'8px 16px',
          fontFamily:"'Cinzel',serif", fontSize:'10px', color:T.gold, zIndex:50, pointerEvents:'none',
          boxShadow:'0 4px 16px rgba(0,0,0,0.6)' }}>
          {encounterToast}
        </div>
      )}

      {/* Fog section creation overlay */}
      {isDM && activeTool === 'fog_section' && (
        <div style={{ position:'absolute', bottom:'16px', left:'50%', transform:'translateX(-50%)',
          background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px', padding:'10px 16px',
          display:'flex', alignItems:'center', gap:'10px', zIndex:30, pointerEvents:'auto',
          boxShadow:'0 4px 16px rgba(0,0,0,0.6)' }}>
          <span style={{ fontFamily:"'Cinzel',serif", fontSize:'9px', color:'rgba(100,180,255,0.9)' }}>
            PAINTING SECTION · {sectionCells.length} cells
          </span>
          <input value={sectionName} onChange={e => setSectionName(e.target.value)} placeholder="Section name…"
            style={{ ...miniInputSt, width:'120px', fontSize:'10px' }} />
          <button onClick={saveFogSection} disabled={sectionSaving || !sectionCells.length}
            style={btnSt(T.gold+'22', T.gold)}>SAVE</button>
          <button onClick={cancelFogSection} style={btnSt('transparent', T.textMuted)}>CANCEL</button>
        </div>
      )}
    </div>
  );
}

// ── Stat Block Modal ───────────────────────────────────────────────────────
function StatBlockModal({ enemyId, onClose }: { enemyId: string; onClose: () => void }) {
  const { data: enemies } = useQuery<EnemyStatBlock[]>({
    queryKey: ['library','enemies'],
    queryFn:  () => api.get('/library/enemies').then(r => r.data?.data ?? []),
    staleTime: 5 * 60_000,
  });
  const enemy = enemies?.find(e => e.id === enemyId);
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:200 }} onClick={onClose}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:'6px', width:'420px', maxWidth:'90vw', maxHeight:'80vh', overflowY:'auto', padding:'20px' }} onClick={e => e.stopPropagation()}>
        {!enemy ? <div style={{ color:T.textMuted, textAlign:'center', padding:'24px 0' }}>Loading…</div> : (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
              <span style={{ fontFamily:"'Cinzel',serif", fontSize:'15px', color:T.gold }}>{enemy.name}</span>
              <button onClick={onClose} style={{ background:'transparent', border:'none', cursor:'pointer', color:T.textMuted, fontSize:'18px' }}>×</button>
            </div>
            <div style={{ display:'flex', gap:'8px', marginBottom:'12px', flexWrap:'wrap' }}>
              {([['POW',enemy.power],['AGI',enemy.agility],['FOC',enemy.focus],['PRE',enemy.presence]] as [string,number][]).map(([k,v]) => (
                <div key={k} style={{ textAlign:'center', background:T.surface, borderRadius:'3px', padding:'6px 10px' }}>
                  <div style={{ fontSize:'8px', color:T.textDim, fontFamily:"'Cinzel',serif" }}>{k}</div>
                  <div style={{ fontSize:'15px', color:T.text, fontWeight:700 }}>{v}</div>
                </div>
              ))}
              {[['HP',enemy.hp,T.hp],['RP',enemy.base_rp,T.rp]].map(([k,v,c]) => (
                <div key={String(k)} style={{ textAlign:'center', background:T.surface, borderRadius:'3px', padding:'6px 10px' }}>
                  <div style={{ fontSize:'8px', color:T.textDim, fontFamily:"'Cinzel',serif" }}>{k}</div>
                  <div style={{ fontSize:'15px', color:String(c), fontWeight:700 }}>{v}</div>
                </div>
              ))}
            </div>
            {enemy.attacks.length > 0 && <>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.textDim, letterSpacing:'0.16em', marginBottom:'6px' }}>ATTACKS</div>
              {enemy.attacks.map((a,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', background:T.surface, borderRadius:'3px', padding:'5px 10px', marginBottom:'3px' }}>
                  <span style={{ fontSize:'11px', color:T.text }}>{a.name}</span>
                  <span style={{ fontSize:'10px', color:T.textMuted }}>{a.damage_dice} {a.damage_type}</span>
                </div>
              ))}
            </>}
            {enemy.traits.length > 0 && <>
              <div style={{ fontFamily:"'Cinzel',serif", fontSize:'8px', color:T.textDim, letterSpacing:'0.16em', margin:'12px 0 6px' }}>TRAITS</div>
              {enemy.traits.map((tr,i) => (
                <div key={i} style={{ fontSize:'10px', color:T.textMuted, marginBottom:'5px', lineHeight:'1.5' }}>
                  <span style={{ color:T.text, fontFamily:"'Cinzel',serif" }}>{tr.name}: </span>{tr.description}
                </div>
              ))}
            </>}
            {enemy.description && <div style={{ fontSize:'10px', color:T.textDim, marginTop:'10px', lineHeight:'1.6', fontStyle:'italic' }}>{enemy.description}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Draw helpers ───────────────────────────────────────────────────────────
function drawRuler(ctx: CanvasRenderingContext2D, start: {x:number;y:number}, end: {x:number;y:number}, px:number,py:number,z:number,cs:number, color:string, fpc:number) {
  const s = cellCentre(start.x,start.y,px,py,z,cs), e = cellCentre(end.x,end.y,px,py,z,cs);
  ctx.beginPath(); ctx.moveTo(s.x,s.y); ctx.lineTo(e.x,e.y);
  ctx.strokeStyle=color; ctx.lineWidth=2; ctx.setLineDash([6,4]); ctx.stroke(); ctx.setLineDash([]);
  const dist = cellDist(start.x,start.y,end.x,end.y);
  const mid  = {x:(s.x+e.x)/2, y:(s.y+e.y)/2};
  ctx.fillStyle=color; ctx.font="bold 11px 'Inter',sans-serif";
  ctx.textAlign='center'; ctx.textBaseline='bottom';
  ctx.fillText(`${(dist*fpc).toFixed(0)}ft`, mid.x, mid.y-3);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: CanvasShape, px:number,py:number,z:number,cz:number, selected=false) {
  const d = shape.data as any;
  ctx.strokeStyle = selected ? '#ffffff' : shape.color;
  ctx.fillStyle   = shape.color + '33';
  ctx.lineWidth   = selected ? 2.5 : 2;
  if (selected) ctx.setLineDash([5,3]);
  switch (shape.shape_type) {
    case 'marker': {
      const cx=px+d.cell_x*cz+cz/2, cy=py+d.cell_y*cz+cz/2, r=Math.max(8,cz*0.28);
      ctx.beginPath(); ctx.moveTo(cx,cy+r); ctx.lineTo(cx,cy+r*2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle=shape.color+'bb'; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx,cy,r*0.35,0,Math.PI*2); ctx.fillStyle=shape.color; ctx.fill(); break;
    }
    case 'circle': ctx.beginPath(); ctx.arc(px+d.cx*cz,py+d.cy*cz,d.r*cz,0,Math.PI*2); ctx.fill(); ctx.stroke(); break;
    case 'rect':   ctx.beginPath(); ctx.rect(px+d.x*cz,py+d.y*cz,d.w*cz,d.h*cz); ctx.fill(); ctx.stroke(); break;
    case 'line':   ctx.beginPath(); ctx.moveTo(px+d.x1*cz,py+d.y1*cz); ctx.lineTo(px+d.x2*cz,py+d.y2*cz); ctx.stroke(); break;
    case 'cone': {
      const ox=px+d.ox*cz,oy=py+d.oy*cz,ex=px+d.ex*cz,ey=py+d.ey*cz;
      const angle=Math.atan2(ey-oy,ex-ox), spread=Math.PI/6, len=Math.hypot(ex-ox,ey-oy);
      ctx.beginPath(); ctx.moveTo(ox,oy);
      ctx.lineTo(ox+Math.cos(angle-spread)*len,oy+Math.sin(angle-spread)*len);
      ctx.arc(ox,oy,len,angle-spread,angle+spread); ctx.lineTo(ox,oy); ctx.closePath(); ctx.fill(); ctx.stroke(); break;
    }
  }
  ctx.setLineDash([]);
}

function getShapeHandles(shape: CanvasShape, px:number,py:number,z:number,cs:number): HandleDef[] {
  const d=shape.data as any, cz=cs*z;
  const g=(gx:number,gy:number)=>gridToCanvas(gx,gy,px,py,z,cs);
  switch (shape.shape_type) {
    case 'marker': return [{ x:px+d.cell_x*cz+cz/2, y:py+d.cell_y*cz+cz/2, type:'move' }];
    case 'circle': { const c=g(d.cx,d.cy),r=g(d.cx+d.r,d.cy); return [{x:c.x,y:c.y,type:'move'},{x:r.x,y:r.y,type:'scale-r'}]; }
    case 'rect': {
      const cx=px+(d.x+d.w/2)*cz, cy=py+(d.y+d.h/2)*cz;
      const x1=px+d.x*cz,y1=py+d.y*cz,x2=px+(d.x+d.w)*cz,y2=py+(d.y+d.h)*cz;
      return [{x:cx,y:cy,type:'move'},{x:x1,y:y1,type:'scale-tl'},{x:x2,y:y1,type:'scale-tr'},{x:x1,y:y2,type:'scale-bl'},{x:x2,y:y2,type:'scale-br'}];
    }
    case 'line': { const p1=g(d.x1,d.y1),p2=g(d.x2,d.y2); return [{x:p1.x,y:p1.y,type:'ep1'},{x:p2.x,y:p2.y,type:'ep2'},{x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2,type:'move'}]; }
    case 'cone': { const o=g(d.ox,d.oy),e=g(d.ex,d.ey); return [{x:o.x,y:o.y,type:'ep1'},{x:e.x,y:e.y,type:'ep2'}]; }
    default: return [];
  }
}

function drawShapeHandles(ctx: CanvasRenderingContext2D, shape: CanvasShape, px:number,py:number,z:number,cs:number) {
  for (const h of getShapeHandles(shape,px,py,z,cs)) {
    ctx.beginPath(); ctx.arc(h.x,h.y,HANDLE_R,0,Math.PI*2);
    ctx.fillStyle = h.type==='move' ? '#ffffff' : (shape.color);
    ctx.fill(); ctx.strokeStyle='#000'; ctx.lineWidth=1.5; ctx.stroke();
  }
}

function applyTransform(ht: HandleType, orig: Record<string,number>, dx:number, dy:number): Record<string,number> {
  switch (ht) {
    case 'move':
      if ('cell_x' in orig) return {...orig, cell_x:orig.cell_x+dx, cell_y:orig.cell_y+dy};
      if ('cx'    in orig) return {...orig, cx:orig.cx+dx, cy:orig.cy+dy};
      if ('x' in orig && 'w' in orig) return {...orig, x:orig.x+dx, y:orig.y+dy};
      if ('x1' in orig) return {...orig, x1:orig.x1+dx, y1:orig.y1+dy, x2:orig.x2+dx, y2:orig.y2+dy};
      if ('ox' in orig) return {...orig, ox:orig.ox+dx, oy:orig.oy+dy, ex:orig.ex+dx, ey:orig.ey+dy};
      return orig;
    case 'scale-r': return {...orig, r:Math.max(0.1,orig.r+dx)};
    case 'scale-tl': return {...orig, x:orig.x+dx, y:orig.y+dy, w:orig.w-dx, h:orig.h-dy};
    case 'scale-tr': return {...orig, y:orig.y+dy, w:orig.w+dx, h:orig.h-dy};
    case 'scale-bl': return {...orig, x:orig.x+dx, w:orig.w-dx, h:orig.h+dy};
    case 'scale-br': return {...orig, w:orig.w+dx, h:orig.h+dy};
    case 'ep1':
      if ('x1' in orig) return {...orig, x1:orig.x1+dx, y1:orig.y1+dy};
      if ('ox' in orig) return {...orig, ox:orig.ox+dx, oy:orig.oy+dy};
      return orig;
    case 'ep2':
      if ('x2' in orig) return {...orig, x2:orig.x2+dx, y2:orig.y2+dy};
      if ('ex' in orig) return {...orig, ex:orig.ex+dx, ey:orig.ey+dy};
      return orig;
    default: return orig;
  }
}

function drawToolPreview(ctx:CanvasRenderingContext2D,tool:ToolMode,color:string,start:{x:number;y:number},cur:{x:number;y:number},px:number,py:number,z:number,cz:number) {
  ctx.strokeStyle=color; ctx.fillStyle=color+'44'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
  switch (tool) {
    case 'marker': {
      const r=Math.max(8,cz*0.28);
      ctx.beginPath(); ctx.moveTo(start.x,start.y+r); ctx.lineTo(start.x,start.y+r*2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(start.x,start.y,r,0,Math.PI*2); ctx.fillStyle=color+'88'; ctx.fill(); ctx.stroke(); break;
    }
    case 'circle': {
      const r=Math.hypot((cur.x-start.x)/cz,(cur.y-start.y)/cz);
      ctx.beginPath(); ctx.arc(start.x,start.y,r*cz,0,Math.PI*2); ctx.fill(); ctx.stroke(); break;
    }
    case 'rect': ctx.beginPath(); ctx.rect(start.x,start.y,cur.x-start.x,cur.y-start.y); ctx.fill(); ctx.stroke(); break;
    case 'line': ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(cur.x,cur.y); ctx.stroke(); break;
    case 'cone': {
      const angle=Math.atan2(cur.y-start.y,cur.x-start.x),spread=Math.PI/6,len=Math.hypot(cur.x-start.x,cur.y-start.y);
      if (len<4) break;
      ctx.beginPath(); ctx.moveTo(start.x,start.y);
      ctx.lineTo(start.x+Math.cos(angle-spread)*len,start.y+Math.sin(angle-spread)*len);
      ctx.arc(start.x,start.y,len,angle-spread,angle+spread); ctx.lineTo(start.x,start.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.setLineDash([3,3]); ctx.strokeStyle=color+'88';
      ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(cur.x,cur.y); ctx.stroke(); break;
    }
  }
  ctx.setLineDash([]);
}

function hitTestShape(cx:number,cy:number,shapes:CanvasShape[],px:number,py:number,z:number,cs:number): CanvasShape|null {
  const cz=cs*z;
  for (const s of [...shapes].reverse()) {
    const d=s.data as any;
    switch (s.shape_type) {
      case 'marker': { const sx=px+d.cell_x*cz+cz/2,sy=py+d.cell_y*cz+cz/2,r=Math.max(8,cz*0.28)*2.5; if(Math.hypot(cx-sx,cy-sy)<=r) return s; break; }
      case 'circle': { const sx=px+d.cx*cz,sy=py+d.cy*cz,r=d.r*cz,dist=Math.hypot(cx-sx,cy-sy); if(dist<=r+6&&dist>=Math.max(0,r-6)) return s; break; }
      case 'rect': { const rx=px+d.x*cz,ry=py+d.y*cz,rw=d.w*cz,rh=d.h*cz; if(cx>=Math.min(rx,rx+rw)-6&&cx<=Math.max(rx,rx+rw)+6&&cy>=Math.min(ry,ry+rh)-6&&cy<=Math.max(ry,ry+rh)+6) return s; break; }
      case 'line': { const x1=px+d.x1*cz,y1=py+d.y1*cz,x2=px+d.x2*cz,y2=py+d.y2*cz,len=Math.hypot(x2-x1,y2-y1); if(len===0) break; const t=Math.max(0,Math.min(1,((cx-x1)*(x2-x1)+(cy-y1)*(y2-y1))/(len*len))); if(Math.hypot(cx-(x1+t*(x2-x1)),cy-(y1+t*(y2-y1)))<=8) return s; break; }
      case 'cone': { const ox=px+d.ox*cz,oy=py+d.oy*cz,ex=px+d.ex*cz,ey=py+d.ey*cz; if(Math.hypot(cx-ox,cy-oy)<=Math.hypot(ex-ox,ey-oy)+6) return s; break; }
    }
  }
  return null;
}

function buildShapeData(tool:'marker'|'circle'|'rect'|'line'|'cone',start:{x:number;y:number},end:{x:number;y:number},px:number,py:number,z:number,cs:number) {
  const cz=cs*z, tg=(v:number,o:number)=>(v-o)/cz;
  switch (tool) {
    case 'marker': return {cell_x:Math.floor(tg(start.x,px)),cell_y:Math.floor(tg(start.y,py))};
    case 'circle': return {cx:tg(start.x,px),cy:tg(start.y,py),r:Math.hypot(tg(end.x,px)-tg(start.x,px),tg(end.y,py)-tg(start.y,py))};
    case 'rect':   return {x:tg(start.x,px),y:tg(start.y,py),w:tg(end.x,px)-tg(start.x,px),h:tg(end.y,py)-tg(start.y,py)};
    case 'line':   return {x1:tg(start.x,px),y1:tg(start.y,py),x2:tg(end.x,px),y2:tg(end.y,py)};
    case 'cone':   return {ox:tg(start.x,px),oy:tg(start.y,py),ex:tg(end.x,px),ey:tg(end.y,py)};
  }
}

function getCursor(tool:ToolMode, panning:boolean): string {
  if (panning) return 'grabbing';
  switch (tool) {
    case 'pan':      return 'grab';
    case 'select':   return 'default';
    case 'fog_reveal': case 'fog_hide': case 'fog_section': case 'ruler': return 'crosshair';
    case 'marker':   return 'cell';
    case 'circle': case 'rect': case 'line': case 'cone': return 'crosshair';
    case 'token_place': return 'copy';
    default: return 'default';
  }
}