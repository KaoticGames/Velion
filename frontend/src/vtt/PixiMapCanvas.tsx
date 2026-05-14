import { useCallback, useEffect, useRef, useState } from 'react';
import { Application, Assets, Container, Graphics, Sprite, Text as PixiText, type Texture } from 'pixi.js';
import { api } from '@/lib/api';
import type { CanvasShape, MapToken, ToolMode } from './types';
import type { MapCanvasProps } from './MapCanvas';

const T = {
  bg:        '#080b10',
  border:    '#1c2230',
  text:      '#e4d8c0',
  textMuted: '#8a7a68',
  gold:      '#c4922a',
  hp:        '#d45c5c',
  rp:        '#3ab5e8',
  green:     '#50a060',
  grid:      '#ffffff',
};

const DRAW_TOOLS: ToolMode[] = ['marker', 'circle', 'rect', 'line', 'cone'];

const colorNumber = (value: string, fallback = 0xffffff) => {
  const cleaned = value.trim().replace(/^#/, '');
  const parsed = Number.parseInt(cleaned.length === 3 ? cleaned.split('').map((c) => c + c).join('') : cleaned, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeFogImageData = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'string' ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
};

function buildShapeData(tool: 'marker' | 'circle' | 'rect' | 'line' | 'cone', start: { x: number; y: number }, end: { x: number; y: number }, cs: number) {
  switch (tool) {
    case 'marker': return { cell_x: Math.floor(start.x / cs), cell_y: Math.floor(start.y / cs) };
    case 'circle': return { cx: start.x / cs, cy: start.y / cs, r: Math.hypot(end.x - start.x, end.y - start.y) / cs };
    case 'rect':   return { x: start.x / cs, y: start.y / cs, w: (end.x - start.x) / cs, h: (end.y - start.y) / cs };
    case 'line':   return { x1: start.x / cs, y1: start.y / cs, x2: end.x / cs, y2: end.y / cs };
    case 'cone':   return { ox: start.x / cs, oy: start.y / cs, ex: end.x / cs, ey: end.y / cs };
  }
}

function drawShape(g: Graphics, shape: CanvasShape, cs: number) {
  const d = shape.data as Record<string, number>;
  const color = colorNumber(shape.color, colorNumber(T.gold));
  g.setStrokeStyle({ color, width: 2, alpha: 0.95 });
  g.setFillStyle({ color, alpha: 0.22 });
  switch (shape.shape_type) {
    case 'marker': {
      const cx = d.cell_x * cs + cs / 2;
      const cy = d.cell_y * cs + cs / 2;
      const r = Math.max(8, cs * 0.28);
      g.moveTo(cx, cy + r).lineTo(cx, cy + r * 2.2).stroke();
      g.circle(cx, cy, r).fill({ color, alpha: 0.32 }).stroke({ color, width: 2 });
      g.circle(cx, cy, r * 0.35).fill({ color, alpha: 0.9 });
      break;
    }
    case 'circle':
      g.circle(d.cx * cs, d.cy * cs, d.r * cs).fill().stroke();
      break;
    case 'rect':
      g.rect(d.x * cs, d.y * cs, d.w * cs, d.h * cs).fill().stroke();
      break;
    case 'line':
      g.moveTo(d.x1 * cs, d.y1 * cs).lineTo(d.x2 * cs, d.y2 * cs).stroke();
      break;
    case 'cone': {
      const ox = d.ox * cs;
      const oy = d.oy * cs;
      const ex = d.ex * cs;
      const ey = d.ey * cs;
      const angle = Math.atan2(ey - oy, ex - ox);
      const spread = Math.PI / 6;
      const len = Math.hypot(ex - ox, ey - oy);
      g.moveTo(ox, oy)
        .lineTo(ox + Math.cos(angle - spread) * len, oy + Math.sin(angle - spread) * len)
        .arc(ox, oy, len, angle - spread, angle + spread)
        .lineTo(ox, oy)
        .fill()
        .stroke();
      break;
    }
  }
}

function isTokenAt(token: MapToken, point: { x: number; y: number }, cs: number) {
  const scale = token.scale ?? 1;
  const r = cs * 0.38 * scale;
  const cx = (token.cell_x + 0.5) * cs;
  const cy = (token.cell_y + 0.5) * cs;
  return Math.hypot(point.x - cx, point.y - cy) <= r;
}

export default function PixiMapCanvas(props: MapCanvasProps) {
  const {
    map, tokens, enemyInstances, fogSections, shapes, rulers,
    isDM, activeTool, toolColor, userId, sessionId, socket, dispatch,
  } = props;

  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const mapTextureRef = useRef<Texture | null>(null);
  const mapObjectUrlRef = useRef<string | null>(null);
  const panX = useRef(0);
  const panY = useRef(0);
  const zoom = useRef(1);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const dragToken = useRef<MapToken | null>(null);
  const toolStart = useRef<{ x: number; y: number } | null>(null);

  const [ready, setReady] = useState(false);
  const [textureVersion, setTextureVersion] = useState(0);
  const [mapLoadError, setMapLoadError] = useState('');
  const [dragPreview, setDragPreview] = useState<{ tokenId: string; cell_x: number; cell_y: number } | null>(null);
  const [localRuler, setLocalRuler] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;

    const app = new Application();
    void app.init({
      background: colorNumber(T.bg),
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    }).then(() => {
      if (cancelled) {
        app.destroy(true);
        return;
      }
      const canvas = app.canvas;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      host.appendChild(canvas);
      const world = new Container();
      app.stage.addChild(world);
      appRef.current = app;
      worldRef.current = world;
      setReady(true);
    });

    return () => {
      cancelled = true;
      setReady(false);
      if (mapObjectUrlRef.current) {
        URL.revokeObjectURL(mapObjectUrlRef.current);
        mapObjectUrlRef.current = null;
      }
      appRef.current?.destroy(true);
      appRef.current = null;
      worldRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMapLoadError('');
    mapTextureRef.current = null;
    setTextureVersion((v) => v + 1);
    if (mapObjectUrlRef.current) {
      URL.revokeObjectURL(mapObjectUrlRef.current);
      mapObjectUrlRef.current = null;
    }

    const load = async () => {
      let src = map.image_url;
      try {
        const { data } = await api.get<Blob>(`/vtt/campaigns/${map.campaign_id}/maps/${map.id}/image`, {
          responseType: 'blob',
        });
        const objectUrl = URL.createObjectURL(data);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        mapObjectUrlRef.current = objectUrl;
        src = objectUrl;
      } catch {
        // Older deployments can still render public map URLs when CORS allows WebGL textures.
      }

      const texture = await Assets.load(src) as Texture;
      if (cancelled) return;
      mapTextureRef.current = texture;
      const host = hostRef.current;
      if (host) {
        const w = texture.width || map.width_cells * map.grid_cell_size;
        const h = texture.height || map.height_cells * map.grid_cell_size;
        const s = Math.min(host.clientWidth / w, host.clientHeight / h, 1);
        zoom.current = s;
        panX.current = (host.clientWidth - w * s) / 2;
        panY.current = (host.clientHeight - h * s) / 2;
      }
      setTextureVersion((v) => v + 1);
    };

    load().catch((err) => {
      if (cancelled) return;
      console.error('[vtt:pixi] map texture load failed:', err);
      setMapLoadError('Pixi map texture failed to load. Check the storage URL or R2/CORS configuration.');
    });

    return () => {
      cancelled = true;
      if (mapObjectUrlRef.current) {
        URL.revokeObjectURL(mapObjectUrlRef.current);
        mapObjectUrlRef.current = null;
      }
    };
  }, [map.campaign_id, map.grid_cell_size, map.height_cells, map.id, map.image_url, map.width_cells]);

  const render = useCallback(() => {
    const world = worldRef.current;
    if (!world) return;
    world.removeChildren();
    world.position.set(panX.current, panY.current);
    world.scale.set(zoom.current);

    const cs = map.grid_cell_size;
    const mapW = mapTextureRef.current?.width || map.width_cells * cs;
    const mapH = mapTextureRef.current?.height || map.height_cells * cs;

    if (mapTextureRef.current) {
      const mapSprite = new Sprite(mapTextureRef.current);
      mapSprite.width = mapW;
      mapSprite.height = mapH;
      world.addChild(mapSprite);
    }

    const grid = new Graphics();
    grid.rect(0, 0, mapW, mapH).stroke({ color: colorNumber(T.border), width: 2 });
    for (let x = 0; x <= map.width_cells; x += 1) {
      const gx = x * cs;
      grid.moveTo(gx, 0).lineTo(gx, map.height_cells * cs).stroke({ color: colorNumber(T.grid), alpha: 0.07, width: 1 });
    }
    for (let y = 0; y <= map.height_cells; y += 1) {
      const gy = y * cs;
      grid.moveTo(0, gy).lineTo(map.width_cells * cs, gy).stroke({ color: colorNumber(T.grid), alpha: 0.07, width: 1 });
    }
    world.addChild(grid);

    fogSections.forEach((section) => {
      const imageData = normalizeFogImageData(section.image_data);
      if (section.is_hidden || !imageData) return;
      try {
        const fog = Sprite.from(imageData);
        fog.width = map.width_cells * cs;
        fog.height = map.height_cells * cs;
        fog.alpha = isDM ? 0.42 : 0.82;
        world.addChild(fog);
      } catch {
        // Ignore malformed legacy fog rows; current canvas path does the same best-effort render.
      }
    });

    const shapeGraphics = new Graphics();
    shapes.forEach((shape) => drawShape(shapeGraphics, shape, cs));
    world.addChild(shapeGraphics);

    tokens.forEach((token) => {
      if (token.is_hidden && !isDM) return;
      const preview = dragPreview?.tokenId === token.id ? dragPreview : null;
      const scale = token.scale ?? 1;
      const r = cs * 0.38 * scale;
      const cx = ((preview?.cell_x ?? token.cell_x) + 0.5) * cs;
      const cy = ((preview?.cell_y ?? token.cell_y) + 0.5) * cs;
      const isEnemy = token.entity_type === 'enemy';
      const g = new Graphics();
      g.circle(cx, cy, r)
        .fill({ color: colorNumber(isEnemy ? '#2a0a0a' : '#0a1a2a'), alpha: token.is_hidden ? 0.45 : 1 })
        .stroke({ color: colorNumber(isEnemy ? T.hp : T.rp), width: 2, alpha: token.is_hidden ? 0.55 : 1 });
      world.addChild(g);

      const inst = enemyInstances.find((e) => e.id === token.entity_id);
      const label = token.label ?? inst?.label ?? '?';
      const text = new PixiText({
        text: label.slice(0, 18),
        style: { fill: T.text, fontSize: 12, fontFamily: 'Inter, sans-serif', align: 'center' },
      });
      text.anchor.set(0.5);
      text.position.set(cx, cy + r + 12);
      world.addChild(text);
    });

    const rulerGraphics = new Graphics();
    const allRulers = [...rulers.values(), ...(localRuler ? [{ user_id: userId, ...localRuler }] : [])];
    allRulers.forEach((ruler) => {
      rulerGraphics
        .moveTo((ruler.start.x + 0.5) * cs, (ruler.start.y + 0.5) * cs)
        .lineTo((ruler.end.x + 0.5) * cs, (ruler.end.y + 0.5) * cs)
        .stroke({ color: colorNumber(T.gold), width: 3, alpha: 0.95 });
    });
    world.addChild(rulerGraphics);
  }, [dragPreview, enemyInstances, fogSections, isDM, localRuler, map, rulers, shapes, tokens, userId]);

  useEffect(() => {
    render();
  }, [ready, render, textureVersion]);

  const screenToWorld = (event: PointerEvent | WheelEvent) => {
    const rect = hostRef.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - panX.current) / zoom.current,
      y: (event.clientY - rect.top - panY.current) / zoom.current,
    };
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const point = screenToWorld(event);
      if (activeTool === 'pan' || (activeTool === 'select' && event.button === 1)) {
        isPanning.current = true;
        panStart.current = { x: event.clientX - panX.current, y: event.clientY - panY.current };
        return;
      }
      if (activeTool === 'ruler') {
        const start = { x: Math.floor(point.x / map.grid_cell_size), y: Math.floor(point.y / map.grid_cell_size) };
        setLocalRuler({ start, end: start });
        toolStart.current = point;
        return;
      }
      if (DRAW_TOOLS.includes(activeTool)) {
        toolStart.current = point;
        return;
      }
      if (activeTool === 'select' && isDM) {
        dragToken.current = [...tokens].reverse().find((token) => (!token.is_hidden || isDM) && isTokenAt(token, point, map.grid_cell_size)) ?? null;
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const point = screenToWorld(event);
      if (isPanning.current) {
        panX.current = event.clientX - panStart.current.x;
        panY.current = event.clientY - panStart.current.y;
        render();
        return;
      }
      if (dragToken.current) {
        setDragPreview({
          tokenId: dragToken.current.id,
          cell_x: Math.floor(point.x / map.grid_cell_size),
          cell_y: Math.floor(point.y / map.grid_cell_size),
        });
        return;
      }
      if (activeTool === 'ruler' && toolStart.current) {
        setLocalRuler((prev) => prev ? {
          start: prev.start,
          end: { x: Math.floor(point.x / map.grid_cell_size), y: Math.floor(point.y / map.grid_cell_size) },
        } : prev);
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const point = screenToWorld(event);
      isPanning.current = false;
      if (dragToken.current) {
        const moved = {
          cell_x: Math.floor(point.x / map.grid_cell_size),
          cell_y: Math.floor(point.y / map.grid_cell_size),
        };
        socket.moveToken(dragToken.current.id, moved.cell_x, moved.cell_y);
        setDragPreview(null);
        dragToken.current = null;
      }
      if (activeTool === 'ruler' && toolStart.current) {
        const start = {
          x: Math.floor(toolStart.current.x / map.grid_cell_size),
          y: Math.floor(toolStart.current.y / map.grid_cell_size),
        };
        const end = { x: Math.floor(point.x / map.grid_cell_size), y: Math.floor(point.y / map.grid_cell_size) };
        socket.updateRuler(start, end);
        setLocalRuler(null);
        toolStart.current = null;
      }
      if (DRAW_TOOLS.includes(activeTool) && toolStart.current && isDM) {
        const data = buildShapeData(activeTool as 'marker' | 'circle' | 'rect' | 'line' | 'cone', toolStart.current, point, map.grid_cell_size);
        void api.post(`/vtt/sessions/${sessionId}/shapes`, { shape_type: activeTool, color: toolColor, data })
          .then((r) => { dispatch({ type: 'SHAPE_ADDED', shape: r.data }); socket.addShape(r.data); })
          .catch(console.error);
        toolStart.current = null;
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const before = screenToWorld(event);
      const factor = event.deltaY < 0 ? 1.1 : 0.9;
      zoom.current = Math.max(0.15, Math.min(4, zoom.current * factor));
      panX.current = event.clientX - rect.left - before.x * zoom.current;
      panY.current = event.clientY - rect.top - before.y * zoom.current;
      render();
    };

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('wheel', onWheel);
    };
  }, [activeTool, dispatch, isDM, map.grid_cell_size, render, sessionId, socket, tokens, toolColor]);

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: T.bg }}>
      {mapLoadError && (
        <div style={{
          position: 'absolute', left: '50%', top: 18, transform: 'translateX(-50%)',
          maxWidth: 560, padding: '10px 14px', borderRadius: 4,
          background: '#111520', border: `1px solid ${T.hp}66`, color: T.hp,
          fontSize: 14, zIndex: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        }}>
          {mapLoadError}
        </div>
      )}
      <div style={{
        position: 'absolute', right: 12, bottom: 10, zIndex: 2,
        fontFamily: "'Cinzel',serif", letterSpacing: '0.12em',
        fontSize: 11, color: T.textMuted, background: 'rgba(17,21,32,0.72)',
        border: `1px solid ${T.border}`, borderRadius: 3, padding: '4px 7px',
      }}>
        PIXI
      </div>
    </div>
  );
}
