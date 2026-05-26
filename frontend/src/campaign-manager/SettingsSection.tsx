import { useState, useRef, type ChangeEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { usePatchCampaign } from '@/hooks/useCampaign';
import { T } from './theme';
import { SectionHead, SectionLabel, inputStyle, SaveBtn } from './ui';

const ASSET_TYPE_COLOR: Record<string, string> = {
  map: '#4a9de8', token: '#9b6fe8', image: '#8a7a68',
};
const fmtBytes = (b: number) =>
  b > 1_000_000 ? `${(b / 1_000_000).toFixed(1)} MB` : b > 1_000 ? `${(b / 1_000).toFixed(0)} KB` : `${b} B`;

interface Props {
  campaign: {
    id: string;
    name: string;
    summary?: string;
    dm_notes?: string;
  };
  onDelete: () => void;
}

export default function SettingsSection({ campaign, onDelete }: Props) {
  const patch = usePatchCampaign(campaign.id);

  const [summary, setSummary] = useState(campaign.summary ?? '');
  const [summSaved, setSummSaved] = useState(false);
  const [notes, setNotes] = useState(campaign.dm_notes ?? '');
  const [notesSaved, setNotesSaved] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [nameSaved, setNameSaved] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const saveSummary = async () => {
    await patch.mutateAsync({ summary });
    setSummSaved(true);
    setTimeout(() => setSummSaved(false), 2000);
  };
  const saveNotes = async () => {
    await patch.mutateAsync({ dm_notes: notes });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };
  const saveName = async () => {
    if (!name.trim()) return;
    await patch.mutateAsync({ name: name.trim() });
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 2000);
  };

  const { data: assets = [], refetch: refetchAssets } = useQuery({
    queryKey: ['campaign-assets', campaign.id],
    queryFn: async () => {
      const { data } = await api.get(`/campaigns/${campaign.id}/assets`);
      return data.data as { id: string; name: string; asset_type: string; url: string; size_bytes: number }[];
    },
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const { data: urlData } = await api.post(`/campaigns/${campaign.id}/assets/upload-url`, {
        filename: file.name, content_type: file.type, name: file.name.replace(/\.[^.]+$/, ''),
      });
      await fetch(urlData.upload_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
      await api.post(`/campaigns/${campaign.id}/assets/confirm`, {
        name: urlData.name, url: urlData.public_url, r2_key: urlData.r2_key, size_bytes: file.size,
      });
      refetchAssets();
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (confirmDelete !== assetId) { setConfirmDelete(assetId); return; }
    setDeletingId(assetId);
    setConfirmDelete(null);
    try {
      await api.delete(`/campaigns/${campaign.id}/assets/${assetId}`);
      refetchAssets();
    } finally {
      setDeletingId(null);
    }
  };

  const taStyle = { ...inputStyle, resize: 'vertical' as const, lineHeight: 1.6 };

  return (
    <div>
      <SectionHead title="Campaign Settings" />

      <SectionLabel>CAMPAIGN SUMMARY</SectionLabel>
      <p style={{ fontSize: '14px', color: T.textMuted, margin: '0 0 8px', fontStyle: 'italic' }}>Visible to all members.</p>
      <textarea value={summary} onChange={e => setSummary(e.target.value)} rows={3} style={{ ...taStyle, marginBottom: '8px' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <SaveBtn disabled={summary === (campaign.summary ?? '')} saved={summSaved} onClick={saveSummary} label="SAVE SUMMARY" />
      </div>

      <SectionLabel>DM NOTES (PRIVATE)</SectionLabel>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={6} style={{ ...taStyle, marginBottom: '8px' }} placeholder="Quick private notes — use Sessions for structured logs" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <SaveBtn disabled={notes === (campaign.dm_notes ?? '')} saved={notesSaved} onClick={saveNotes} label="SAVE NOTES" />
      </div>

      <SectionLabel>ASSETS</SectionLabel>
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" onChange={handleUpload} style={{ display: 'none' }} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{
          fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
          background: 'transparent', border: `1px solid ${T.gold}`, color: T.gold,
          borderRadius: '3px', padding: '8px 18px', cursor: uploading ? 'not-allowed' : 'pointer', marginBottom: '12px',
        }}
      >{uploading ? '↑ UPLOADING…' : '+ UPLOAD ASSET'}</button>
      {uploadError && <span style={{ fontSize: '13px', color: T.hp, marginLeft: '10px' }}>{uploadError}</span>}

      {assets.length === 0 ? (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, padding: '16px', textAlign: 'center', color: T.textDim, fontSize: '13px' }}>NO ASSETS</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px', marginBottom: '20px' }}>
          {assets.map(asset => {
            const ac = ASSET_TYPE_COLOR[asset.asset_type] ?? T.textMuted;
            return (
              <div key={asset.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: '3px', overflow: 'hidden', position: 'relative' }}>
                <div style={{ height: 80, background: T.card }}>
                  <img src={asset.url} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.name}</div>
                  <div style={{ fontSize: '11px', color: ac }}>{asset.asset_type} · {fmtBytes(asset.size_bytes)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteAsset(asset.id)}
                  disabled={deletingId === asset.id}
                  style={{ position: 'absolute', top: 4, right: 4, fontSize: '10px', background: '#000a', border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: 2, padding: '2px 6px', cursor: 'pointer' }}
                >✕</button>
              </div>
            );
          })}
        </div>
      )}

      <SectionLabel>CAMPAIGN NAME</SectionLabel>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <input value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <SaveBtn disabled={name.trim() === campaign.name} saved={nameSaved} onClick={saveName} label="SAVE" />
      </div>

      <button
        type="button"
        onClick={() => { if (!confirmDel) setConfirmDel(true); else onDelete(); }}
        onBlur={() => setConfirmDel(false)}
        style={{
          fontFamily: "'Cinzel',serif", fontSize: '12px', letterSpacing: '0.14em',
          background: confirmDel ? T.hp : 'transparent', border: `1px solid ${T.hp}`,
          borderRadius: '2px', padding: '8px 16px', cursor: 'pointer',
          color: confirmDel ? '#080b10' : T.hp,
        }}
      >
        {confirmDel ? 'CONFIRM DELETE CAMPAIGN' : 'DELETE CAMPAIGN'}
      </button>
    </div>
  );
}
