import type { CampaignManagerSession, CampaignManagerEncounter } from '@/lib/campaignManager';
import { uid } from '@/lib/campaignManager';
import { T } from './theme';
import { SectionHead, SubHead, SectionLabel, inputStyle } from './ui';

interface Props {
  sessions: CampaignManagerSession[];
  encounters: CampaignManagerEncounter[];
  campaignPlans: string;
  onChangeSessions: (sessions: CampaignManagerSession[]) => void;
  onChangePlans: (plans: string) => void;
}

export default function SessionsSection({
  sessions, encounters, campaignPlans, onChangeSessions, onChangePlans,
}: Props) {
  const addSession = () => {
    const now = new Date().toISOString();
    onChangeSessions([...sessions, {
      id: uid(),
      title: 'New Session',
      plans: '',
      notes: '',
      completedEncounterIds: [],
      status: 'planned',
      createdAt: now,
    }]);
  };

  const update = (id: string, patch: Partial<CampaignManagerSession>) => {
    onChangeSessions(sessions.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const remove = (id: string) => {
    onChangeSessions(sessions.filter(s => s.id !== id));
  };

  const toggleEncounter = (sessionId: string, encId: string) => {
    const s = sessions.find(x => x.id === sessionId);
    if (!s) return;
    const has = s.completedEncounterIds.includes(encId);
    const completedEncounterIds = has
      ? s.completedEncounterIds.filter(e => e !== encId)
      : [...s.completedEncounterIds, encId];
    update(sessionId, { completedEncounterIds });
  };

  return (
    <div>
      <SectionHead title="Session Management" />
      <p style={{ fontSize: '15px', color: T.textMuted, lineHeight: 1.65, margin: '0 0 16px' }}>
        Track session notes, prep plans, and which encounters have been run.
      </p>

      <SectionLabel>CAMPAIGN ARC & PLANS</SectionLabel>
      <textarea
        value={campaignPlans}
        onChange={e => onChangePlans(e.target.value)}
        placeholder="Long-term plot, recurring NPCs, upcoming arcs…"
        rows={5}
        style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
        <SubHead>Sessions</SubHead>
        <button
          type="button"
          onClick={addSession}
          style={{
            fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
            background: 'transparent', border: `1px solid ${T.gold}`, color: T.gold,
            borderRadius: '2px', padding: '6px 14px', cursor: 'pointer',
          }}
        >+ ADD SESSION</button>
      </div>

      {sessions.length === 0 ? (
        <div style={{
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px',
          padding: '24px', textAlign: 'center', color: T.textDim,
          fontFamily: "'Cinzel',serif", letterSpacing: '0.14em', fontSize: '13px',
        }}>NO SESSIONS LOGGED</div>
      ) : sessions.map(s => (
        <div key={s.id} style={{
          background: T.card, border: `1px solid ${T.border}`, borderRadius: '3px',
          padding: '16px', marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <input
              value={s.title}
              onChange={e => update(s.id, { title: e.target.value })}
              style={{ ...inputStyle, flex: 1, minWidth: '200px', fontFamily: "'Cinzel',serif", letterSpacing: '0.08em' }}
            />
            <select
              value={s.status}
              onChange={e => update(s.id, { status: e.target.value as CampaignManagerSession['status'] })}
              style={{ ...inputStyle, width: 'auto', flex: '0 0 140px' }}
            >
              <option value="planned">Planned</option>
              <option value="played">Played</option>
              <option value="archived">Archived</option>
            </select>
            <button
              type="button"
              onClick={() => remove(s.id)}
              style={{
                fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.1em',
                background: 'transparent', border: `1px solid ${T.hp}`, color: T.hp,
                borderRadius: '2px', padding: '6px 10px', cursor: 'pointer',
              }}
            >DELETE</button>
          </div>
          <label style={{ fontSize: '12px', color: T.textDim, display: 'block', marginBottom: '4px' }}>Session plans</label>
          <textarea
            value={s.plans}
            onChange={e => update(s.id, { plans: e.target.value })}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: '10px', lineHeight: 1.55 }}
          />
          <label style={{ fontSize: '12px', color: T.textDim, display: 'block', marginBottom: '4px' }}>Session notes (after play)</label>
          <textarea
            value={s.notes}
            onChange={e => update(s.id, { notes: e.target.value })}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical', marginBottom: '12px', lineHeight: 1.55 }}
          />
          {encounters.length > 0 && (
            <>
              <div style={{ fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.16em', color: T.textDim, marginBottom: '6px' }}>ENCOUNTERS COMPLETED</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {encounters.map(enc => {
                  const done = s.completedEncounterIds.includes(enc.id);
                  return (
                    <button
                      key={enc.id}
                      type="button"
                      onClick={() => toggleEncounter(s.id, enc.id)}
                      style={{
                        fontFamily: "'Cinzel',serif", fontSize: '11px', letterSpacing: '0.1em',
                        padding: '4px 10px', borderRadius: '2px', cursor: 'pointer',
                        background: done ? T.green + '22' : T.surface,
                        border: `1px solid ${done ? T.green : T.border}`,
                        color: done ? T.green : T.textMuted,
                      }}
                    >{enc.name}{done ? ' ✓' : ''}</button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
