import type { StoryStatus } from '../../shared/types';

export type {
  PageStatus,
  StoryStatus,
  Character,
  Page,
  Scenario,
  StoryMeta,
  StoryDetail,
  GenerationProgress,
  CreateStoryRequest,
  CreateStoryResponse,
} from '../../shared/types';

export interface StorySummary {
  id: string;
  prompt: string;
  status: StoryStatus;
  createdAt: string;
  title?: string;
  coverImage?: string;
  totalPages: number;
  completedPages: number;
  isPublic?: boolean;
}
