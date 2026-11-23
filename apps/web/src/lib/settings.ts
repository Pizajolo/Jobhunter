import { useMutation, useQuery } from '@tanstack/react-query';
import type { Settings } from '@jobhunter/shared';
import { api, queryClient } from './api';

type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type SettingsPatch = DeepPartial<Settings>;

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/api/settings') });
}

export function useUpdateSettings() {
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patch<Settings>('/api/settings', patch),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}
