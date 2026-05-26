import { useState, useEffect, useMemo, useCallback } from 'react';
import type { CampaignDetail, CampaignMember } from '@/hooks/useCampaign';
import { usePatchCampaign } from '@/hooks/useCampaign';
import {
  MANAGER_SECTIONS,
  parseCampaignManager,
  mergeCampaignManagerSettings,
  type ManagerSectionId,
  type CampaignManagerState,
} from '@/lib/campaignManager';
import { T } from './theme';
import { SaveBtn } from './ui';
import PartyOverviewSection from './PartyOverviewSection';
import EncountersSection from './EncountersSection';
import SessionsSection from './SessionsSection';
import LootSection from './LootSection';
import SettingsSection from './SettingsSection';

interface Props {
  campaign: CampaignDetail & { summary?: string; dm_notes?: string };
  onDelete: () => void;
}

export default function CampaignManager({ campaign, onDelete }: Props) {
  const [active, setActive] = useState<ManagerSectionId>('party');
  const patch = usePatchCampaign(campaign.id);

  const [manager, setManager] = useState<CampaignManagerState>(() =>
    parseCampaignManager(campaign.settings),
  );
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setManager(parseCampaignManager(campaign.settings));
    setDirty(false);
  }, [campaign.id, campaign.settings]);

  const members = campaign.members ?? [];

  const { partySize, avgPartyBaseRP } = useMemo(() => {
    const withChars = members.filter((m: CampaignMember) => m.character);
    const size = withChars.length;
    const avg = size
      ? Math.round(withChars.reduce((s, m) => s + (m.character?.base_rp ?? 0), 0) / size)
      : 0;
    return { partySize: size, avgPartyBaseRP: avg };
  }, [members]);

  const updateManager = useCallback((updater: (prev: CampaignManagerState) => CampaignManagerState) => {
    setManager(prev => {
      setDirty(true);
      return updater(prev);
    });
  }, []);

  const saveManager = async () => {
    const nextSettings = mergeCampaignManagerSettings(campaign.settings, manager);
    await patch.mutateAsync({ settings: nextSettings });
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  };

  const content = (() => {
    switch (active) {
      case 'party':
        return <PartyOverviewSection members={members} />;
      case 'encounters':
        return (
          <EncountersSection
            encounters={manager.encounters}
            activeEncounterId={manager.activeEncounterId}
            partySize={partySize}
            avgPartyBaseRP={avgPartyBaseRP}
            onChange={(encounters, activeEncounterId) =>
              updateManager(prev => ({ ...prev, encounters, activeEncounterId }))
            }
          />
        );
      case 'sessions':
        return (
          <SessionsSection
            sessions={manager.sessions}
            encounters={manager.encounters}
            campaignPlans={manager.campaignPlans}
            onChangeSessions={sessions => updateManager(prev => ({ ...prev, sessions }))}
            onChangePlans={campaignPlans => updateManager(prev => ({ ...prev, campaignPlans }))}
          />
        );
      case 'loot':
        return (
          <LootSection
            encounters={manager.encounters}
            members={members}
            onChangeEncounters={encounters => updateManager(prev => ({ ...prev, encounters }))}
          />
        );
      case 'settings':
        return (
          <SettingsSection
            campaign={{
              id: campaign.id,
              name: campaign.name,
              summary: (campaign as { summary?: string }).summary,
              dm_notes: (campaign as { dm_notes?: string }).dm_notes,
            }}
            onDelete={onDelete}
          />
        );
      default:
        return null;
    }
  })();

  const needsManagerSave = dirty && active !== 'settings';

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 'calc(100vh - 220px)', background: T.bg }}>

      {/* Sidebar — Compendium-style */}
      <div style={{
        width: '240px', flexShrink: 0, borderRight: `1px solid ${T.border}`,
        overflowY: 'auto', padding: '20px 0', background: T.surface,
      }}>
        <div style={{
          padding: '0 18px 14px', fontFamily: "'Cinzel',serif", fontSize: '12px',
          letterSpacing: '0.28em', color: T.textDim,
        }}>CAMPAIGN MANAGER</div>

        {MANAGER_SECTIONS.map(sec => (
          <button
            key={sec.id}
            type="button"
            onClick={() => setActive(sec.id)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '9px 18px', background: active === sec.id ? T.goldFaint : 'transparent',
              border: 'none',
              borderLeft: active === sec.id ? `2px solid ${T.dmGold}` : '2px solid transparent',
              color: active === sec.id ? T.dmGold : T.textMuted,
              cursor: 'pointer',
              fontFamily: "'Cinzel',serif", fontSize: '13px', letterSpacing: '0.12em',
              transition: 'all 0.12s',
            }}
          >
            {sec.label}
          </button>
        ))}

        {needsManagerSave && (
          <div style={{ padding: '16px 18px 0' }}>
            <SaveBtn
              disabled={patch.isPending}
              saved={savedFlash}
              onClick={saveManager}
              label={patch.isPending ? 'SAVING…' : 'SAVE PROGRESS'}
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 48px' }}>
        {needsManagerSave && (
          <div style={{
            marginBottom: '16px', padding: '10px 14px',
            background: T.dmGold + '12', border: `1px solid ${T.dmGold}44`,
            borderRadius: '3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontSize: '14px', color: T.textMuted }}>Unsaved encounter / session / loot changes</span>
            <SaveBtn disabled={patch.isPending} saved={savedFlash} onClick={saveManager} label="SAVE" />
          </div>
        )}
        <div style={{ maxWidth: '920px' }}>
          {content}
        </div>
      </div>
    </div>
  );
}
