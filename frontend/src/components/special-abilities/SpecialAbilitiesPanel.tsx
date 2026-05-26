import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api, { extractApiError } from '@/lib/api';
import {
  type CharacterSpecialAbility,
  type SpecialAbilityDraft,
  type SpecialAbilityTemplate,
  RESOLUTION_OPTIONS,
  DIE_TYPES,
  DAMAGE_TYPES,
  emptyAbilityDraft,
  draftToPayload,
} from '@/lib/specialAbilities';

const T = {
  bg: '#06070c', surface: '#0a0c14', card: '#0d1018', border: '#1c2030',
  gold: '#c4922a', text: '#e4d8c0', textMuted: '#706858', textDim: '#282430',
  accent: '#5a8a7a', hp: '#e05050',
};

const inp = (xtra: Record<string, unknown> = {}) => ({
  background: T.surface,
  border: `1px solid ${T.border}`,
  color: T.text,
  borderRadius: '3px',
  padding: '6px 10px',
  fontSize: '16px',
  fontFamily: "'EB Garamond',serif",
  width: '100%',
  outline: 'none',
  ...xtra,
});

const lbl = {
  fontFamily: "'Cinzel',serif",
  fontSize: '12px',
  letterSpacing: '0.14em',
  color: T.textMuted,
  textTransform: 'uppercase' as const,
  display: 'block',
  marginBottom: '4px',
};

const Btn = (c: string, xtra: Record<string, unknown> = {}) => ({
  background: 'transparent',
  border: `1px solid ${c}`,
  color: c,
  borderRadius: '3px',
  padding: '5px 12px',
  fontSize: '13px',
  fontFamily: "'Cinzel',serif",
  letterSpacing: '0.08em',
  cursor: 'pointer',
  ...xtra,
});

type WizardProps = {
  mode: 'wizard';
  drafts: SpecialAbilityDraft[];
  onDraftsChange: (next: SpecialAbilityDraft[]) => void;
  canCreateCustom: boolean;
};

type SheetProps = {
  mode: 'sheet';
  characterId: string;
  abilities: CharacterSpecialAbility[];
  onAbilitiesChange: (next: CharacterSpecialAbility[]) => void;
  canCreateCustom: boolean;
  onUse?: (ability: CharacterSpecialAbility) => void;
};

type Props = WizardProps | SheetProps;

function AbilityForm({
  draft,
  onChange,
  onCancel,
  onSave,
  canCreateCustom,
  saving,
}: {
  draft: SpecialAbilityDraft;
  onChange: (d: SpecialAbilityDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  canCreateCustom: boolean;
  saving: boolean;
}) {
  const showDice = draft.resolution_model === 'weapon_like' || draft.resolution_model === 'gem_like';
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.accent}44`, borderRadius: '3px', padding: '14px', marginTop: '10px' }}>
      <div style={{ marginBottom: '10px' }}>
        <label style={lbl}>Name</label>
        <input value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} style={inp()} placeholder="e.g. Second Wind" />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label style={lbl}>Description</label>
        <textarea
          value={draft.description}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={4}
          style={{ ...inp(), resize: 'vertical', lineHeight: 1.6 }}
          placeholder="What does this ability do? When does it fit your story?"
        />
      </div>
      {canCreateCustom && (
        <>
          <div style={{ marginBottom: '10px' }}>
            <label style={lbl}>Combat resolution (optional)</label>
            <select
              value={draft.resolution_model}
              onChange={(e) => onChange({ ...draft, resolution_model: e.target.value as SpecialAbilityDraft['resolution_model'] })}
              style={inp()}
            >
              {RESOLUTION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {showDice && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              <div>
                <label style={lbl}>Dice</label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={draft.num_dice}
                  onChange={(e) => onChange({ ...draft, num_dice: e.target.value === '' ? '' : Number(e.target.value) })}
                  style={inp()}
                />
              </div>
              <div>
                <label style={lbl}>Die</label>
                <select
                  value={draft.die_type}
                  onChange={(e) => onChange({ ...draft, die_type: Number(e.target.value) })}
                  style={inp()}
                >
                  {DIE_TYPES.map((d) => (
                    <option key={d} value={d}>d{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={lbl}>Type</label>
                <select value={draft.damage_type} onChange={(e) => onChange({ ...draft, damage_type: e.target.value })} style={inp()}>
                  {DAMAGE_TYPES.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div style={{ marginBottom: '10px' }}>
            <label style={lbl}>RP note (hint only)</label>
            <input
              value={draft.suggested_rp_note ?? ''}
              onChange={(e) => onChange({ ...draft, suggested_rp_note: e.target.value })}
              style={inp()}
              placeholder="e.g. Often staked lightly — table decides"
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: T.textMuted, marginBottom: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!draft.is_public}
              onChange={(e) => onChange({ ...draft, is_public: e.target.checked })}
            />
            Share in public library
          </label>
        </>
      )}
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={Btn(T.textMuted)}>CANCEL</button>
        <button type="button" onClick={onSave} disabled={saving || !draft.name.trim()} style={Btn(T.accent, { opacity: saving || !draft.name.trim() ? 0.5 : 1 })}>
          {saving ? 'SAVING…' : 'SAVE'}
        </button>
      </div>
    </div>
  );
}

export default function SpecialAbilitiesPanel(props: Props) {
  const { canCreateCustom } = props;
  const [modal, setModal] = useState<'browse' | 'create' | 'edit' | null>(null);
  const [draft, setDraft] = useState<SpecialAbilityDraft>(emptyAbilityDraft());
  const [library, setLibrary] = useState<SpecialAbilityTemplate[]>([]);
  const [libSearch, setLibSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get<{ data: SpecialAbilityTemplate[] }>('/library/special-abilities');
      setLibrary(data.data ?? []);
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modal === 'browse') loadLibrary();
  }, [modal, loadLibrary]);

  const filteredLib = library.filter((a) =>
    !libSearch || a.name.toLowerCase().includes(libSearch.toLowerCase()),
  );

  const closeModal = () => {
    setModal(null);
    setDraft(emptyAbilityDraft());
    setEditIndex(null);
    setError('');
  };

  const saveWizardDraft = () => {
    if (props.mode !== 'wizard') return;
    const next = [...props.drafts];
    if (editIndex !== null) next[editIndex] = draft;
    else next.push(draft);
    props.onDraftsChange(next);
    closeModal();
  };

  const saveSheetAbility = async () => {
    if (props.mode !== 'sheet') return;
    setSaving(true);
    setError('');
    try {
      const payload = draftToPayload(draft);
      const { data } = await api.post<CharacterSpecialAbility>(
        `/characters/${props.characterId}/special-abilities`,
        payload,
      );
      props.onAbilitiesChange([...props.abilities, data]);
      closeModal();
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const attachFromLibrary = async (tpl: SpecialAbilityTemplate) => {
    if (props.mode === 'wizard') {
      props.onDraftsChange([
        ...props.drafts,
        {
          ability_id: tpl.id,
          name: tpl.name,
          description: tpl.description,
          resolution_model: tpl.resolution_model,
          num_dice: tpl.num_dice ?? '',
          die_type: tpl.die_type ?? 6,
          damage_type: tpl.damage_type ?? 'Physical',
          suggested_rp_note: tpl.suggested_rp_note ?? '',
          applies_states: tpl.applies_states ?? [],
          secondary_effect_text: tpl.secondary_effect_text ?? '',
        },
      ]);
      closeModal();
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post<CharacterSpecialAbility>(
        `/characters/${props.characterId}/special-abilities`,
        { ability_id: tpl.id },
      );
      props.onAbilitiesChange([...props.abilities, data]);
      closeModal();
    } catch (err) {
      setError(extractApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const removeAt = async (index: number, rowId?: string) => {
    if (props.mode === 'wizard') {
      props.onDraftsChange(props.drafts.filter((_, i) => i !== index));
      return;
    }
    if (!rowId) return;
    try {
      await api.delete(`/characters/${props.characterId}/special-abilities/${rowId}`);
      props.onAbilitiesChange(props.abilities.filter((a) => a.id !== rowId));
    } catch (err) {
      setError(extractApiError(err).message);
    }
  };

  return (
    <div>
      <p style={{ color: T.textMuted, fontSize: '15px', lineHeight: 1.6, marginBottom: '12px', fontFamily: "'EB Garamond',serif" }}>
        Abilities come from who your character is — your backstory is the source of truth.
        In combat, costs are paid in RP at the table; there are no fixed uses or charges.
      </p>

      {(props.mode === 'wizard' ? props.drafts.length === 0 : props.abilities.length === 0) && (
        <div style={{ color: T.textDim, textAlign: 'center', padding: '20px 0', fontSize: '16px', border: `1px dashed ${T.border}`, borderRadius: '3px', marginBottom: '12px' }}>
          No special abilities yet
        </div>
      )}

      {props.mode === 'wizard' && props.drafts.map((d, i) => (
        <div key={`w-${i}`} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', padding: '10px 12px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '17px', fontWeight: 500, color: T.text, marginBottom: '4px' }}>{d.name}</div>
              <div style={{ fontSize: '14px', color: T.textMuted, lineHeight: 1.5 }}>{d.description || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button type="button" onClick={() => { setDraft({ ...d }); setEditIndex(i); setModal('edit'); }} style={Btn(T.gold, { padding: '2px 8px', fontSize: '12px' })}>✎</button>
              <button type="button" onClick={() => removeAt(i)} style={Btn(T.hp, { padding: '2px 8px', fontSize: '12px' })}>✕</button>
            </div>
          </div>
        </div>
      ))}

      {props.mode === 'sheet' && props.abilities.map((a) => (
        <div key={a.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', padding: '10px 12px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '17px', fontWeight: 500, color: T.text, marginBottom: '4px' }}>{a.name}</div>
              <div style={{ fontSize: '14px', color: T.textMuted, lineHeight: 1.5, marginBottom: '6px' }}>{a.description || '—'}</div>
              {a.suggested_rp_note && (
                <div style={{ fontSize: '13px', color: T.accent, fontStyle: 'italic' }}>RP: {a.suggested_rp_note}</div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
              {props.onUse && (a.resolution_model === 'weapon_like' || a.resolution_model === 'gem_like') && (
                <button type="button" onClick={() => props.onUse!(a)} style={Btn(T.accent, { padding: '4px 10px', fontSize: '12px' })}>USE</button>
              )}
              {a.resolution_model === 'healing' && props.onUse && (
                <button type="button" onClick={() => props.onUse!(a)} style={Btn('#50a050', { padding: '4px 10px', fontSize: '12px' })}>HEAL</button>
              )}
              <button type="button" onClick={() => removeAt(0, a.id)} style={Btn(T.hp, { padding: '2px 8px', fontSize: '12px' })}>✕</button>
            </div>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
        <button type="button" onClick={() => { setModal('browse'); setDraft(emptyAbilityDraft()); }} style={Btn(T.accent)}>
          + FROM LIBRARY
        </button>
        {canCreateCustom && (
          <button type="button" onClick={() => { setDraft(emptyAbilityDraft()); setEditIndex(null); setModal('create'); }} style={Btn(T.gold)}>
            + CREATE CUSTOM
          </button>
        )}
      </div>

      {!canCreateCustom && (
        <p style={{ fontSize: '13px', color: T.textMuted, marginTop: '8px', fontFamily: "'EB Garamond',serif" }}>
          Free accounts can attach public abilities from the library. Ask your DM to publish a custom ability, or upgrade to create your own.
        </p>
      )}

      {error && <p style={{ color: T.hp, fontSize: '14px', marginTop: '8px' }}>{error}</p>}

      {modal === 'browse' && typeof document !== 'undefined' && createPortal(
        <>
          <div
            aria-hidden
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 999 }}
            onClick={closeModal}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="special-abilities-library-title"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px',
              boxSizing: 'border-box',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                pointerEvents: 'auto',
                background: T.card,
                border: `1px solid ${T.border}`,
                borderTop: `2px solid ${T.accent}`,
                borderRadius: '4px',
                padding: '20px',
                width: '100%',
                maxWidth: '520px',
                maxHeight: 'min(80vh, calc(100vh - 48px))',
                overflow: 'auto',
                boxShadow: '0 12px 48px rgba(0,0,0,0.65)',
              }}
            >
              <div id="special-abilities-library-title" style={{ fontFamily: "'Cinzel',serif", color: T.accent, marginBottom: '12px', letterSpacing: '0.12em' }}>PUBLIC ABILITIES</div>
              <input value={libSearch} onChange={(e) => setLibSearch(e.target.value)} placeholder="Search…" style={{ ...inp(), marginBottom: '12px' }} />
              {loading && <div style={{ color: T.textMuted, textAlign: 'center', padding: '16px' }}>Loading…</div>}
              {!loading && filteredLib.length === 0 && (
                <div style={{ color: T.textDim, textAlign: 'center', padding: '16px' }}>No public abilities found.</div>
              )}
              {filteredLib.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => attachFromLibrary(tpl)}
                  disabled={saving}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', padding: '10px', marginBottom: '8px', cursor: 'pointer', color: T.text }}
                >
                  <div style={{ fontWeight: 500, marginBottom: '4px' }}>{tpl.name}</div>
                  <div style={{ fontSize: '14px', color: T.textMuted }}>{tpl.description.slice(0, 120)}{tpl.description.length > 120 ? '…' : ''}</div>
                </button>
              ))}
              <button type="button" onClick={closeModal} style={{ ...Btn(T.textMuted), width: '100%', marginTop: '8px' }}>CLOSE</button>
            </div>
          </div>
        </>,
        document.body,
      )}

      {(modal === 'create' || modal === 'edit') && (
        <AbilityForm
          draft={draft}
          onChange={setDraft}
          onCancel={closeModal}
          onSave={props.mode === 'wizard' ? saveWizardDraft : saveSheetAbility}
          canCreateCustom={canCreateCustom}
          saving={saving}
        />
      )}
    </div>
  );
}
