/**
 * TanStack Query hooks for Org/User Settings
 *
 * Merges user-level settings (from Supabase user_settings table) with
 * org-level AI config (from /api/settings/ai) into a single cached query.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { settingsService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type { UserSettings } from '@/lib/supabase/settings';

// ============ TYPES ============

export interface OrgAISettings {
  aiEnabled: boolean;
  aiProvider: string;
  aiModel: string;
  aiGoogleKey: string;
  aiOpenaiKey: string;
  aiAnthropicKey: string;
  aiHasGoogleKey?: boolean;
  aiHasOpenaiKey?: boolean;
  aiHasAnthropicKey?: boolean;
}

export interface MergedOrgSettings extends UserSettings {
  // Org-level AI overrides/additions
  aiOrgEnabled: boolean;
  aiKeyConfigured: boolean;
}

// ============ QUERY HOOKS ============

/**
 * Fetches and merges user settings + org AI config.
 * Replaces the fetchSettings() logic previously in SettingsContext.
 */
export const useOrgSettings = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<MergedOrgSettings>({
    queryKey: queryKeys.orgSettings.lists(),
    queryFn: async () => {
      // 1. Fetch user-level settings (per-user prefs: aiThinking, aiSearch, etc.)
      const { data: settings, error: settingsError } = await settingsService.get();
      if (settingsError) throw settingsError;

      // 2. Fetch org-level AI config (provider, model, api keys, enabled flag)
      const aiRes = await fetch('/api/settings/ai', { credentials: 'include' });
      if (!aiRes.ok) {
        throw new Error(`Failed to fetch AI settings: ${aiRes.statusText}`);
      }
      const aiData: OrgAISettings = await aiRes.json();

      const base: UserSettings = settings ?? {
        aiProvider: 'google',
        aiApiKey: '',
        aiGoogleKey: '',
        aiOpenaiKey: '',
        aiAnthropicKey: '',
        aiModel: '',
        aiThinking: true,
        aiSearch: true,
        aiAnthropicCaching: false,
        darkMode: true,
        defaultRoute: '/boards',
        activeBoardId: null,
        inboxViewMode: 'list',
        onboardingCompleted: false,
      };

      const aiKeyConfigured =
        !!(aiData.aiGoogleKey || aiData.aiOpenaiKey || aiData.aiAnthropicKey) ||
        !!(aiData.aiHasGoogleKey || aiData.aiHasOpenaiKey || aiData.aiHasAnthropicKey);

      return {
        ...base,
        // Override with org-level AI values where present
        aiProvider: (aiData.aiProvider as UserSettings['aiProvider']) || base.aiProvider,
        aiModel: aiData.aiModel || base.aiModel,
        aiGoogleKey: aiData.aiGoogleKey || base.aiGoogleKey,
        aiOpenaiKey: aiData.aiOpenaiKey || base.aiOpenaiKey,
        aiAnthropicKey: aiData.aiAnthropicKey || base.aiAnthropicKey,
        // Merged extras
        aiOrgEnabled: aiData.aiEnabled ?? false,
        aiKeyConfigured,
      };
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: (query) => query.state.dataUpdatedAt === 0 || query.state.isInvalidated,
    refetchOnReconnect: false,
    enabled: !authLoading && !!user && externalEnabled,
  });
};

// ============ MUTATION HOOKS ============

/** Updates user-level settings (per-user prefs) */
export const useUpdateUserSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<UserSettings>) => {
      const { error } = await settingsService.update(updates);
      if (error) throw error;
      return updates;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgSettings.all });
    },
  });
};

/** Updates org-level AI settings via the /api/settings/ai endpoint */
export const useUpdateAISettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<OrgAISettings>) => {
      const res = await fetch('/api/settings/ai', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        throw new Error(`Failed to update AI settings: ${res.statusText}`);
      }
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.orgSettings.all });
    },
  });
};
