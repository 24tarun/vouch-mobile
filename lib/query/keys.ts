import type { QueryKey } from '@tanstack/react-query';

export const queryKeys = {
  currentProfile: (userId: string | null | undefined): QueryKey => ['current-profile', userId ?? null],
  relationships: (userId: string | null | undefined): QueryKey => ['relationships', userId ?? null],
  blockedUsers: (userId: string | null | undefined): QueryKey => ['blocked-users', userId ?? null],
  settingsStats: (userId: string | null | undefined): QueryKey => ['settings-stats', userId ?? null],
  taskLists: (userId: string | null | undefined, sortMode: string): QueryKey => ['task-lists', userId ?? null, sortMode],
  taskDetail: (taskId: string | null | undefined): QueryKey => ['task-detail', taskId ?? null],
  friendQueue: (userId: string | null | undefined): QueryKey => ['friend-queue', userId ?? null],
  friendHistory: (userId: string | null | undefined, search: string): QueryKey => ['friend-history', userId ?? null, search],
  commitments: (userId: string | null | undefined): QueryKey => ['commitments', userId ?? null],
  commitmentLinks: (commitmentId: string | null | undefined): QueryKey => ['commitment-links', commitmentId ?? null],
  ledger: (userId: string | null | undefined): QueryKey => ['ledger', userId ?? null],
} as const;
