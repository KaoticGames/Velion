/**
 * socket/session.ts — Socket.io session namespace
 *
 * Namespace:  /session
 * Auth:       access_token in handshake.auth
 * Room:       session:{session_id}
 * DM room:    session:{session_id}:dm
 * OBS room:   obs:{campaign_id}:{source_type}
 */

import { Server, Socket }        from 'socket.io';
import { verifyAccessToken }     from '../lib/jwt';
import { db }                    from '../db';
import {
  sessions, campaigns, campaignCharacters,
  mapTokens, sessionEnemyInstances, canvasShapes, diceLogEntries, maps, mapFogCells, fogSections,
} from '../db/schema';
import { eq, and, isNull }       from 'drizzle-orm';

export const registerSessionNamespace = (io: Server): void => {
  const ns = io.of('/session');

  ns.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('UNAUTHORIZED'));
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('TOKEN_INVALID'));
    }
  });

  ns.on('connection', (socket: Socket) => {
    const userId = socket.data.user?.user_id as string;

    // ── session:join ─────────────────────────────────────────────────
    socket.on('session:join', async ({ session_id, character_id }: {
      session_id: string; character_id?: string;
    }) => {
      try {
        const [sess] = await db.select().from(sessions).where(eq(sessions.id, session_id)).limit(1);
        if (!sess) { socket.emit('session:error', { code: 'NOT_FOUND' }); return; }

        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, sess.campaign_id)).limit(1);
        if (!campaign) { socket.emit('session:error', { code: 'NOT_FOUND' }); return; }

        const isDM = campaign.dm_user_id === userId;
        if (!isDM) {
          const [membership] = await db.select().from(campaignCharacters)
            .where(and(
              eq(campaignCharacters.campaign_id, sess.campaign_id),
              eq(campaignCharacters.user_id, userId),
              isNull(campaignCharacters.removed_at),
            )).limit(1);
          if (!membership) { socket.emit('session:error', { code: 'FORBIDDEN' }); return; }
        }

        const room = `session:${session_id}`;
        await socket.join(room);
        socket.data.session_id   = session_id;
        socket.data.campaign_id  = sess.campaign_id;
        socket.data.character_id = character_id;
        socket.data.is_dm        = isDM;
        if (isDM) await socket.join(`${room}:dm`);

        const activeMap = sess.active_map_id
          ? (await db.select().from(maps).where(eq(maps.id, sess.active_map_id)).limit(1))[0] ?? null
          : null;

        const tokens = sess.active_map_id
          ? await db.select().from(mapTokens).where(and(eq(mapTokens.session_id, session_id), eq(mapTokens.map_id, sess.active_map_id)))
          : [];

        const enemyInst = await db.select().from(sessionEnemyInstances).where(eq(sessionEnemyInstances.session_id, session_id));

        const shapes = sess.active_map_id
          ? await db.select().from(canvasShapes).where(and(eq(canvasShapes.session_id, session_id), eq(canvasShapes.map_id, sess.active_map_id)))
          : [];

        const fogCells = activeMap
          ? await db.select().from(mapFogCells).where(eq(mapFogCells.map_id, activeMap.id))
          : [];

        const fogSectionsList = activeMap
          ? await db.select().from(fogSections).where(eq(fogSections.map_id, activeMap.id))
          : [];

        const allDice = await db.select().from(diceLogEntries).where(eq(diceLogEntries.session_id, session_id));
        const diceLog = isDM ? allDice : allDice.filter(e => e.visibility === 'public' || e.roller_id === userId);

        const campaignMaps = isDM ? await db.select().from(maps).where(eq(maps.campaign_id, sess.campaign_id)) : [];

        socket.emit('session:state', { session: sess, activeMap, tokens, enemyInstances: enemyInst, shapes, fogCells, fogSections: fogSectionsList, diceLog, campaignMaps, isDM });
        socket.to(room).emit('session:user_joined', { user_id: userId, character_id, is_dm: isDM });
        console.log(`[socket] ${isDM ? 'DM' : 'Player'} joined session ${session_id}: ${userId}`);
      } catch (err) {
        console.error('[socket] session:join error:', err);
        socket.emit('session:error', { code: 'INTERNAL_ERROR' });
      }
    });

    // ── session:start ─────────────────────────────────────────────────
    socket.on('session:start', async () => {
      if (!socket.data.is_dm) return;
      const session_id = socket.data.session_id as string;
      try {
        const [updated] = await db.update(sessions).set({ is_started: true }).where(eq(sessions.id, session_id)).returning();
        ns.to(`session:${session_id}`).emit('session:started', { session: updated });
        console.log(`[socket] Session started: ${session_id}`);
      } catch (err) { console.error('[socket] session:start error:', err); }
    });

    // ── session:map_change ────────────────────────────────────────────
    socket.on('session:map_change', async ({ map_id }: { map_id: string }) => {
      if (!socket.data.is_dm) return;
      const session_id = socket.data.session_id as string;
      try {
        const [map] = await db.select().from(maps).where(eq(maps.id, map_id)).limit(1);
        if (!map) return;
        await db.update(sessions).set({ active_map_id: map_id }).where(eq(sessions.id, session_id));
        const tokens          = await db.select().from(mapTokens).where(and(eq(mapTokens.session_id, session_id), eq(mapTokens.map_id, map_id)));
        const shapes          = await db.select().from(canvasShapes).where(and(eq(canvasShapes.session_id, session_id), eq(canvasShapes.map_id, map_id)));
        const fogCells        = await db.select().from(mapFogCells).where(eq(mapFogCells.map_id, map_id));
        const fogSectionsList = await db.select().from(fogSections).where(eq(fogSections.map_id, map_id));
        ns.to(`session:${session_id}`).emit('session:map_changed', { map, tokens, shapes, fogCells, fogSections: fogSectionsList });
      } catch (err) { console.error('[socket] session:map_change error:', err); }
    });

    // ── token:move ────────────────────────────────────────────────────
    socket.on('token:move', async ({ token_id, cell_x, cell_y }: { token_id: string; cell_x: number; cell_y: number }) => {
      try {
        await db.update(mapTokens).set({ cell_x, cell_y }).where(eq(mapTokens.id, token_id));
        socket.to(`session:${socket.data.session_id}`).emit('token:moved', { token_id, cell_x, cell_y, moved_by: userId });
      } catch (err) { console.error('[socket] token:move error:', err); }
    });

    // ── token:placed / token:removed ──────────────────────────────────
    socket.on('token:placed', (token: Record<string, unknown>) => {
      if (!socket.data.is_dm) return;
      socket.to(`session:${socket.data.session_id}`).emit('token:placed', token);
    });
    socket.on('token:removed', ({ token_id }: { token_id: string }) => {
      if (!socket.data.is_dm) return;
      socket.to(`session:${socket.data.session_id}`).emit('token:removed', { token_id });
    });

    // ── enemy:hp_update ───────────────────────────────────────────────
    socket.on('enemy:hp_update', async ({ instance_id, current_hp, is_defeated }: { instance_id: string; current_hp: number; is_defeated?: boolean }) => {
      if (!socket.data.is_dm) return;
      try {
        const updates: Record<string, unknown> = { current_hp: BigInt(Math.max(0, current_hp)) };
        if (is_defeated !== undefined) updates.is_defeated = is_defeated;
        await db.update(sessionEnemyInstances).set(updates).where(eq(sessionEnemyInstances.id, instance_id));
        ns.to(`session:${socket.data.session_id}`).emit('enemy:hp_updated', { instance_id, current_hp, is_defeated });
      } catch (err) { console.error('[socket] enemy:hp_update error:', err); }
    });

    // ── fog:update ────────────────────────────────────────────────────
    socket.on('fog:update', async ({ cells }: { cells: Array<{ x: number; y: number; revealed: boolean }> }) => {
      if (!socket.data.is_dm) return;
      const session_id = socket.data.session_id as string;
      try {
        const [sess] = await db.select().from(sessions).where(eq(sessions.id, session_id)).limit(1);
        if (!sess?.active_map_id) return;
        for (const cell of cells) {
          await db.insert(mapFogCells)
            .values({ map_id: sess.active_map_id, cell_x: cell.x, cell_y: cell.y, is_revealed: cell.revealed })
            .onConflictDoUpdate({
              target: [mapFogCells.map_id, mapFogCells.cell_x, mapFogCells.cell_y],
              set: { is_revealed: cell.revealed },
            });
        }
        socket.to(`session:${session_id}`).emit('fog:updated', { cells });
      } catch (err) { console.error('[socket] fog:update error:', err); }
    });

    // ── shapes ────────────────────────────────────────────────────────
    socket.on('shape:add',       (shape: Record<string, unknown>) => {
      socket.to(`session:${socket.data.session_id}`).emit('shape:added', shape);
    });
    socket.on('shape:remove',    ({ shape_id }: { shape_id: string }) => {
      socket.to(`session:${socket.data.session_id}`).emit('shape:removed', { shape_id });
    });
    socket.on('shape:clear_all', () => {
      if (!socket.data.is_dm) return;
      socket.to(`session:${socket.data.session_id}`).emit('shape:all_cleared');
    });

    // ── ruler ──────────────────────────────────────────────────────────
    // Never persisted — purely visual sync
    socket.on('ruler:update', ({ start, end }: { start: { x: number; y: number }; end: { x: number; y: number } }) => {
      socket.to(`session:${socket.data.session_id}`).emit('ruler:updated', { user_id: userId, start, end });
    });
    socket.on('ruler:clear', () => {
      socket.to(`session:${socket.data.session_id}`).emit('ruler:cleared', { user_id: userId });
    });

    // ── dice:roll ──────────────────────────────────────────────────────
    // Client rolls 3D dice, sends results here for persist + broadcast
    socket.on('dice:roll', async (payload: {
      formula: string; label: string; visibility: 'public' | 'private' | 'dm';
      results: number[]; total: number; source_label?: string;
    }) => {
      const session_id  = socket.data.session_id as string;
      const campaign_id = socket.data.campaign_id as string;
      const room        = `session:${session_id}`;
      const entry       = { roller_id: userId, ...payload, source_label: payload.source_label ?? null };

      try { await db.insert(diceLogEntries).values({ session_id, ...entry }); }
      catch (err) { console.error('[socket] dice:roll persist error:', err); }

      if (payload.visibility === 'public') {
        ns.to(room).emit('dice:result', entry);
        ns.to(`obs:${campaign_id}:dice_log`).emit('dice:result', entry);
      } else if (payload.visibility === 'dm') {
        socket.emit('dice:result', entry);
        if (!socket.data.is_dm) socket.to(`${room}:dm`).emit('dice:result', entry);
      } else {
        socket.emit('dice:result', entry);
      }
    });

    // ── attack:rolled ──────────────────────────────────────────────────
    // Stat block roll with source context. Same visibility rules as dice:roll.
    socket.on('attack:rolled', async (payload: {
      source_label: string; formula: string; results: number[]; total: number;
      damage_type?: string; visibility: 'public' | 'dm';
    }) => {
      const session_id  = socket.data.session_id as string;
      const campaign_id = socket.data.campaign_id as string;
      const room        = `session:${session_id}`;
      const label       = payload.damage_type ? `${payload.source_label} (${payload.damage_type})` : payload.source_label;
      const entry       = { roller_id: userId, formula: payload.formula, results: payload.results, total: payload.total, label, visibility: payload.visibility, source_label: payload.source_label };

      try { await db.insert(diceLogEntries).values({ session_id, ...entry }); }
      catch (err) { console.error('[socket] attack:rolled persist error:', err); }

      if (payload.visibility === 'public') {
        ns.to(room).emit('dice:result', entry);
        ns.to(`obs:${campaign_id}:dice_log`).emit('dice:result', entry);
      } else {
        socket.emit('dice:result', entry);
        if (!socket.data.is_dm) socket.to(`${room}:dm`).emit('dice:result', entry);
      }
    });

    // ── obs:join ───────────────────────────────────────────────────────
    socket.on('obs:join', ({ campaign_id, source_type }: { campaign_id: string; source_type: string }) => {
      socket.join(`obs:${campaign_id}:${source_type}`);
    });

    // ── disconnect ─────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      socket.to(`session:${socket.data.session_id}`).emit('session:user_left', { user_id: userId, is_dm: socket.data.is_dm });
      console.log(`[socket] Disconnected: ${userId}`);
    });
  });
};