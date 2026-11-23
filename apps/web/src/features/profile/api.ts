import { useQuery } from '@tanstack/react-query';
import type { Profile, ProfileFact, StyleProfile } from '@jobhunter/shared';
import { api } from '../../lib/api';

export interface ProfileResponse {
  profile: Profile;
  version: number;
  facts: ProfileFact[];
  history: { version: number; source: string; createdAt: string }[];
}

export interface ProfileImport {
  id: number;
  kind: 'cv' | 'linkedin_pdf';
  filename: string;
  text: string;
  extracted: Profile | null;
  status: 'extracting' | 'review' | 'applied' | 'discarded' | 'failed';
  error: string | null;
}

export interface InterviewTurn {
  done: boolean;
  question: string | null;
  topic: string | null;
  why: string | null;
}

export interface InterviewSession {
  id: number;
  status: 'active' | 'summarizing' | 'completed' | 'abandoned';
  state: {
    history: { question: string; answer: string | null; topic: string | null }[];
    current: InterviewTurn | null;
    summary: { summary: string; facts: { text: string; category: string; basedOnQuestion: number }[] } | null;
  };
}

export interface StyleResponse {
  profiles: StyleProfile[];
  samples: { id: number; language: string; text: string; source: string; createdAt: string }[];
}

export const useProfile = () => useQuery({ queryKey: ['profile'], queryFn: () => api.get<ProfileResponse>('/api/profile') });
export const useStyle = () => useQuery({ queryKey: ['style'], queryFn: () => api.get<StyleResponse>('/api/style') });
export const useInterview = () => useQuery({ queryKey: ['interview'], queryFn: () => api.get<InterviewSession | null>('/api/interview') });
export const useLatestImport = (poll: boolean) =>
  useQuery({
    queryKey: ['profile-import'],
    queryFn: () => api.get<ProfileImport | null>('/api/profile/imports/latest'),
    refetchInterval: (q) => (poll || q.state.data?.status === 'extracting' ? 1500 : false),
  });
