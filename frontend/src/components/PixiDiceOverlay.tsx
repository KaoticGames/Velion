import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Application, Container, Graphics, Text as PixiText } from 'pixi.js';
import type { DiceResult } from '@/vtt/types';
import type { DiceAnimationFace } from '@/lib/diceAnimationSpec';

const T = {
  bg:   '#080b10',
  gold: '#c4922a',
  text: '#e4d8c0',
  card: '#111520',
  rp:   '#3ab5e8',
};

type RollStartPayload = {
  roll_id?: string;
  physics_notation?: string;
  animation_spec?: DiceAnimationFace[];
  total?: number;
  label?: string;
  source_label?: string | null;
  server_started_at?: string;
};

type ActiveRoll = {
  rollId: string;
  label: string;
  sourceLabel: string | null;
  faces: DiceAnimationFace[];
  total: number;
  startedAt: number;
};

const faceColor = (sides: number) => {
  if (sides === 20) return 0xc4922a;
  if (sides === 100) return 0x8a5cf6;
  if (sides === 10) return 0x3ab5e8;
  if (sides >= 12) return 0xd45c5c;
  return 0x50a060;
};

const fallbackFaces = (entry: DiceResult): DiceAnimationFace[] =>
  entry.results.map((value) => ({ sides: 20, value }));

export default function PixiDiceOverlay() {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const ownRollIdsRef = useRef<Set<string>>(new Set());
  const startsRef = useRef<Map<string, RollStartPayload>>(new Map());
  const activeRollRef = useRef<ActiveRoll | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const [activeRoll, setActiveRoll] = useState<ActiveRoll | null>(null);

  useEffect(() => {
    activeRollRef.current = activeRoll;
  }, [activeRoll]);

  useEffect(() => {
    const onLocalStart = (event: Event) => {
      const detail = (event as CustomEvent<RollStartPayload>).detail;
      if (detail?.roll_id) ownRollIdsRef.current.add(detail.roll_id);
    };
    const onRemoteStart = (event: Event) => {
      const detail = (event as CustomEvent<RollStartPayload>).detail;
      if (!detail?.roll_id || ownRollIdsRef.current.has(detail.roll_id)) return;
      if (detail.animation_spec?.length) {
        setActiveRoll({
          rollId: detail.roll_id,
          label: detail.label || 'Dice Roll',
          sourceLabel: detail.source_label ?? null,
          faces: detail.animation_spec,
          total: detail.total ?? detail.animation_spec.reduce((sum, face) => sum + face.value, 0),
          startedAt: detail.server_started_at ? Date.parse(detail.server_started_at) || Date.now() : Date.now(),
        });
        return;
      }
      startsRef.current.set(detail.roll_id, detail);
    };
    const onResult = (event: Event) => {
      const entry = (event as CustomEvent<DiceResult>).detail;
      if (!entry?.roll_id || ownRollIdsRef.current.has(entry.roll_id)) return;
      if (activeRollRef.current?.rollId === entry.roll_id) return;
      const start = startsRef.current.get(entry.roll_id);
      startsRef.current.delete(entry.roll_id);
      const faces = entry.animation_spec?.length ? entry.animation_spec : fallbackFaces(entry);
      if (!faces.length) return;
      setActiveRoll({
        rollId: entry.roll_id,
        label: entry.label || start?.label || 'Dice Roll',
        sourceLabel: entry.source_label ?? start?.source_label ?? null,
        faces,
        total: entry.total,
        startedAt: start?.server_started_at ? Date.parse(start.server_started_at) || Date.now() : Date.now(),
      });
    };

    window.addEventListener('velion:dice-roll-network-start', onLocalStart as EventListener);
    window.addEventListener('velion:session-dice-roll-start', onRemoteStart as EventListener);
    window.addEventListener('velion:dice-result-pending', onResult as EventListener);
    return () => {
      window.removeEventListener('velion:dice-roll-network-start', onLocalStart as EventListener);
      window.removeEventListener('velion:session-dice-roll-start', onRemoteStart as EventListener);
      window.removeEventListener('velion:dice-result-pending', onResult as EventListener);
      if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeRoll) return undefined;
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return undefined;

    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);

    const app = new Application();
    void app.init({
      backgroundAlpha: 0,
      resizeTo: window,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    }).then(() => {
      if (cancelled) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.display = 'block';
      host.appendChild(app.canvas);

      const w = window.innerWidth;
      const h = window.innerHeight;
      const layer = new Container();
      app.stage.addChild(layer);

      const scrim = new Graphics()
        .rect(0, 0, w, h)
        .fill({ color: 0x000000, alpha: 0.38 });
      layer.addChild(scrim);

      const title = new PixiText({
        text: activeRoll.sourceLabel ? `${activeRoll.sourceLabel} - ${activeRoll.label}` : activeRoll.label,
        style: { fill: T.text, fontSize: 20, fontFamily: 'Cinzel, serif', align: 'center' },
      });
      title.anchor.set(0.5);
      title.position.set(w / 2, h * 0.24);
      layer.addChild(title);

      const dice = activeRoll.faces.map((face, index) => {
        const die = new Container();
        const body = new Graphics()
          .roundRect(-28, -28, 56, 56, 9)
          .fill({ color: faceColor(face.sides), alpha: 0.92 })
          .stroke({ color: 0xffffff, alpha: 0.26, width: 2 });
        const value = new PixiText({
          text: String(face.value),
          style: { fill: T.bg, fontSize: 18, fontFamily: 'Cinzel, serif', fontWeight: '700' },
        });
        value.anchor.set(0.5);
        const sides = new PixiText({
          text: `d${face.sides}`,
          style: { fill: T.card, fontSize: 10, fontFamily: 'Inter, sans-serif' },
        });
        sides.anchor.set(0.5);
        sides.position.set(0, 18);
        die.addChild(body, value, sides);
        layer.addChild(die);
        const cols = Math.max(1, Math.ceil(Math.sqrt(activeRoll.faces.length)));
        const row = Math.floor(index / cols);
        const col = index % cols;
        const spread = 76;
        const targetX = w / 2 + (col - (cols - 1) / 2) * spread;
        const targetY = h / 2 + (row - (Math.ceil(activeRoll.faces.length / cols) - 1) / 2) * spread;
        return {
          die,
          startX: targetX + (index % 2 === 0 ? -180 : 180),
          startY: -80 - index * 18,
          targetX,
          targetY,
          spin: (index % 2 === 0 ? 1 : -1) * (Math.PI * 2 + index * 0.4),
        };
      });

      const total = new PixiText({
        text: `TOTAL ${activeRoll.total}`,
        style: { fill: T.gold, fontSize: 26, fontFamily: 'Cinzel, serif', fontWeight: '700' },
      });
      total.anchor.set(0.5);
      total.alpha = 0;
      total.position.set(w / 2, h * 0.74);
      layer.addChild(total);

      const duration = 1150;
      const started = performance.now();
      app.ticker.add(() => {
        const t = Math.min(1, (performance.now() - started) / duration);
        const ease = 1 - (1 - t) ** 3;
        dice.forEach((item) => {
          item.die.position.set(
            item.startX + (item.targetX - item.startX) * ease,
            item.startY + (item.targetY - item.startY) * ease,
          );
          item.die.rotation = item.spin * (1 - ease);
          item.die.scale.set(0.8 + 0.2 * ease);
        });
        total.alpha = Math.max(0, (t - 0.72) / 0.28);
      });

      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setActiveRoll(null);
      }, 3100);
    });

    return () => {
      cancelled = true;
      appRef.current?.destroy(true);
      appRef.current = null;
    };
  }, [activeRoll]);

  if (!activeRoll) return null;

  return createPortal(
    <div
      ref={hostRef}
      style={{ position: 'fixed', inset: 0, zIndex: 24500, pointerEvents: 'none' }}
      aria-hidden="true"
    />,
    document.body,
  );
}
