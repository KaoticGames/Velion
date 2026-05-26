import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, extractApiError } from '@/lib/api';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CampaignSummary {
  id:                  string;
  dm_user_id:          string;
  name:                string;
  world_tier_baseline: string;
  settings:            Record<string, unknown>;
  created_at:          string;
  deleted_at:          string | null;
}

export interface CampaignMember {
  membership: {
    id:           string;
    campaign_id:  string;
    character_id: string;
    user_id:      string;
    joined_at:    string;
    removed_at:   string | null;
  };
  character: {
    id:            string;
    name:          string;
    level:         number;
    base_rp:       number;
    max_hp:        number;
    current_hp:    number;
    portrait_url:  string | null;
    chosen_attribute: string;
  } | null;
  user: { id: string; email: string } | null;
}

export interface CampaignInvite {
  id:          string;
  campaign_id: string;
  token:       string;
  max_uses:    number | null;
  use_count:   number;
  expires_at:  string | null;
  created_at:  string;
}

export interface CampaignSession {
  id:            string;
  campaign_id:   string;
  name:          string;
  status:        'scheduled' | 'active' | 'paused' | 'ended';
  active_map_id: string | null;
  started_at:    string | null;
  ended_at:      string | null;
}

export interface CampaignDetail extends CampaignSummary {
  summary?:  string;
  dm_notes?: string;
  members:   CampaignMember[];
  invites:   CampaignInvite[] | null; // null for non-DMs
  invite?:   CampaignInvite | null;
}

export interface InvitePreview {
  campaign: { id: string; name: string; world_tier_baseline: string };
  dm:       { email: string };
  invite:   { max_uses: number | null; use_count: number; expires_at: string | null };
}

// ── Query Keys ────────────────────────────────────────────────────────────

export const campaignKeys = {
  all:      ()         => ['campaigns'] as const,
  list:     ()         => [...campaignKeys.all(), 'list'] as const,
  detail:   (id: string) => [...campaignKeys.all(), 'detail', id] as const,
  sessions: (id: string) => [...campaignKeys.all(), 'sessions', id] as const,
  preview:  (token: string) => ['invite-preview', token] as const,
};

// ── Hooks ─────────────────────────────────────────────────────────────────

export function useCampaignList() {
  return useQuery({
    queryKey: campaignKeys.list(),
    queryFn:  async () => {
      const { data } = await api.get<{ data: CampaignSummary[] }>('/campaigns');
      return data.data;
    },
    staleTime: 30_000,
  });
}

export function useCampaign(id: string | undefined) {
  return useQuery({
    queryKey: campaignKeys.detail(id ?? ''),
    queryFn:  async () => {
      const { data } = await api.get<CampaignDetail>(`/campaigns/${id}`);
      return data;
    },
    enabled:   !!id,
    staleTime: 30_000,
  });
}

export function useCampaignSessions(id: string | undefined) {
  return useQuery({
    queryKey: campaignKeys.sessions(id ?? ''),
    queryFn:  async () => {
      const { data } = await api.get<{ data: CampaignSession[] }>(`/campaigns/${id}/sessions`);
      return data.data;
    },
    enabled:   !!id,
    staleTime: 30_000,
  });
}

export function useInvitePreview(token: string | undefined) {
  return useQuery({
    queryKey: campaignKeys.preview(token ?? ''),
    queryFn:  async () => {
      const { data } = await api.get<InvitePreview>(`/campaigns/invite-preview/${token}`);
      return data;
    },
    enabled:   !!token,
    staleTime: 60_000,
    retry:     false,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { name: string; world_tier_baseline?: string }) => {
      const { data } = await api.post<CampaignSummary>('/campaigns', payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.list() }),
  });
}

export function usePatchCampaign(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<CampaignSummary, 'name' | 'world_tier_baseline' | 'settings'>> & { summary?: string; dm_notes?: string }) => {
      const { data } = await api.patch<CampaignSummary>(`/campaigns/${id}`, patch);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: campaignKeys.detail(id) });
      qc.invalidateQueries({ queryKey: campaignKeys.list() });
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/campaigns/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.list() }),
  });
}

export function useCreateInvite(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { max_uses?: number | null; expires_hours?: number | null }) => {
      const { data } = await api.post<CampaignInvite>(`/campaigns/${campaignId}/invites`, payload);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
  });
}

export function useRevokeInvite(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      await api.delete(`/campaigns/${campaignId}/invites/${inviteId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
  });
}

export function useRemoveMember(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (characterId: string) => {
      await api.delete(`/campaigns/${campaignId}/members/${characterId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
  });
}

export function useCreateSession(campaignId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post<CampaignSession>(`/campaigns/${campaignId}/sessions`, { name });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: campaignKeys.sessions(campaignId) }),
  });
}

export function useJoinCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { token: string; character_id: string }) => {
      const { data } = await api.post(`/campaigns/join/${payload.token}`, {
        character_id: payload.character_id,
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: campaignKeys.list() });
    },
  });
}