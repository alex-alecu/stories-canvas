export type PageStatus = 'pending' | 'generating' | 'completed' | 'failed';

export type StoryStatus = 'generating_scenario' | 'generating_characters' | 'generating_images' | 'completed' | 'failed';

export interface Character {
  name: string;
  role: string;
  appearance: string;
  clothing: string;
  personality: string;
  characterSheetPrompt: string;
}

export interface Page {
  pageNumber: number;
  text: string;
  imagePrompt: string;
  characters: string[];
  status: PageStatus;
  imageUrl?: string;
}

export interface Scenario {
  title: string;
  targetAge: number;
  characters: Character[];
  pages: Page[];
}

export interface StoryMeta {
  id: string;
  prompt: string;
  status: StoryStatus;
  createdAt: string;
  scenario?: Scenario;
  coverImage?: string;
  userId?: string;
}

export interface StoryDetail extends StoryMeta {
  scenario: Scenario;
}

export interface GenerationProgress {
  storyId: string;
  status: StoryStatus;
  currentPhase: string;
  completedPages: number;
  totalPages: number;
  failedPages: number[];
  message: string;
}

export interface CreateStoryRequest {
  prompt: string;
}

export interface CreateStoryResponse {
  id: string;
  status: StoryStatus;
}
