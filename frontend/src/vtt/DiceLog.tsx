/**
 * DiceLog.tsx — Roll history panel
 *
 * Primary line uses `formula` as a full breakdown when present (e.g. "14 + 2 = 16").
 */

import type { DiceLogEntry } from './types';

const T = {
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

const VISIBILITY_ICON: Record<string, string> = {
  public:  '🌐',
  private: '🔒',
  dm:      '👁',
};

const VISIBILITY_COLOR: Record<string, string> = {
  public:  T.text,
  private: T.rp,
  dm:      T.gold,
};

interface Props {
  entries: DiceLogEntry[];
  userId:  string;
  isDM:    boolean;
}

export default function DiceLog({ entries, userId, isDM }: Props) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '10px 10px 6px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.22em', color: T.textDim }}>
          DICE LOG
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {entries.length === 0 && (
          <div style={{ fontSize: '13px', color: T.textDim, textAlign: 'center', padding: '16px 0', fontFamily: "'Cinzel',serif", letterSpacing: '0.12em' }}>
            NO ROLLS YET
          </div>
        )}

        {entries.map((entry, i) => {
          const isOwn       = entry.roller_id === userId;
          const color       = VISIBILITY_COLOR[entry.visibility] ?? T.text;
          const isHighTotal = entry.total >= 18;
          const isLowTotal  = entry.total <= 3 && entry.results.length > 0;
          const hasBreakdown = typeof entry.formula === 'string' && entry.formula.includes('=');

          return (
            <div
              key={entry.id ?? i}
              style={{
                background: T.card,
                border: `1px solid ${isOwn ? color + '44' : T.border}`,
                borderRadius: '3px',
                padding: '6px 8px',
                opacity: entry.visibility === 'private' && !isOwn && !isDM ? 0 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ fontSize: '12px', color: T.textMuted, fontFamily: "'Cinzel',serif", letterSpacing: '0.08em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                  {entry.source_label ?? (isDM ? 'DM Roll' : isOwn ? 'You' : 'Player')}
                </span>
                <span style={{ fontSize: '14px', flexShrink: 0 }} title={entry.visibility}>
                  {VISIBILITY_ICON[entry.visibility]}
                </span>
              </div>

              {entry.label && (
                <div style={{ fontSize: '13px', color: T.textMuted, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.label}
                </div>
              )}

              {hasBreakdown ? (
                <div style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: T.text,
                  fontFamily: "'Cinzel',serif",
                  letterSpacing: '0.04em',
                  lineHeight: 1.35,
                  wordBreak: 'break-word',
                }}>
                  {entry.formula}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    {entry.results.map((r, ri) => (
                      <span
                        key={ri}
                        style={{
                          fontSize: '14px', fontWeight: 700, padding: '1px 4px',
                          borderRadius: '2px',
                          background: T.surface,
                          color: T.textMuted,
                          border: `1px solid ${T.border}`,
                        }}
                      >{r}</span>
                    ))}
                  </div>
                  <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <span style={{ fontSize: '12px', color: T.textDim }}>{entry.formula} = </span>
                    <span style={{
                      fontSize: '19px', fontWeight: 700,
                      color: isHighTotal ? T.green : isLowTotal ? T.hp : color,
                      fontFamily: "'Cinzel',serif",
                    }}>
                      {entry.total}
                    </span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
