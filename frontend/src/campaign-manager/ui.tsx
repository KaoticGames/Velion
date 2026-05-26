import type { ReactNode } from 'react';
import { T } from './theme';

export const DMBadge = () => (
  <span style={{
    fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.2em',
    color: T.dmGold, background: T.dmGold + '18', border: `1px solid ${T.dmGold}44`,
    borderRadius: '3px', padding: '2px 7px', marginLeft: '8px', verticalAlign: 'middle',
  }}>DM</span>
);

export const SectionHead = ({ title }: { title: string }) => (
  <h2 style={{
    fontFamily: "'Cinzel',serif", fontSize: '20px', letterSpacing: '0.2em',
    color: T.dmGold, margin: '0 0 12px', fontWeight: '600',
  }}>
    {title}<DMBadge />
  </h2>
);

export const SubHead = ({ children }: { children: ReactNode }) => (
  <h3 style={{
    fontFamily: "'Cinzel',serif", fontSize: '14px', letterSpacing: '0.18em',
    color: T.textMuted, margin: '18px 0 8px', fontWeight: '600', textTransform: 'uppercase',
  }}>{children}</h3>
);

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div style={{
    fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.26em',
    color: T.textDim, marginBottom: '10px', marginTop: '20px',
    borderBottom: `1px solid ${T.border}`, paddingBottom: '6px',
  }}>{children}</div>
);

export const Formula = ({ children }: { children: string }) => (
  <div style={{
    fontFamily: "'Courier New', monospace", fontSize: '15px', color: T.rp,
    background: T.rp + '11', border: `1px solid ${T.rp}33`,
    borderRadius: '3px', padding: '8px 14px', margin: '8px 0',
  }}>{children}</div>
);

export const Callout = ({ label, children, color = T.dmGold }: {
  label: string; children: ReactNode; color?: string;
}) => (
  <div style={{
    border: `1px solid ${color}44`, borderLeft: `3px solid ${color}`,
    borderRadius: '3px', background: color + '0a', padding: '12px 14px', margin: '12px 0',
  }}>
    <div style={{ fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.16em', color, marginBottom: '6px' }}>{label}</div>
    <div style={{ fontSize: '15px', color: T.text, lineHeight: '1.65' }}>{children}</div>
  </div>
);

export const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: '3px',
  padding: '10px 12px',
  color: T.text,
  fontSize: '15px',
  outline: 'none',
  fontFamily: 'inherit',
};

export const SaveBtn = ({ disabled, saved, onClick, label }: {
  disabled: boolean; saved: boolean; onClick: () => void; label: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    style={{
      fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
      background: saved ? T.green : !disabled ? T.gold : T.goldDim,
      border: `1px solid ${saved ? T.green : T.gold}`,
      borderRadius: '2px', padding: '6px 16px',
      cursor: !disabled ? 'pointer' : 'not-allowed',
      color: '#080b10', fontWeight: '700',
    }}
  >
    {saved ? '✓ SAVED' : label}
  </button>
);

export function rollFormula(formula: string): { results: number[]; total: number } {
  const match = formula.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (!match) return { results: [0], total: 0 };
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const mod = parseInt(match[3] ?? '0', 10);
  const results: number[] = [];
  for (let i = 0; i < count; i++) results.push(Math.floor(Math.random() * sides) + 1);
  return { results, total: results.reduce((s, n) => s + n, 0) + mod };
}
