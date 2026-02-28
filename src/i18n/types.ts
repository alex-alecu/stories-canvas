export type Language = 'ro' | 'de' | 'es' | 'en' | 'fr' | 'it' | 'pt' | 'nl' | 'hu' | 'pl' | 'cs' | 'sk' | 'sv' | 'no' | 'da' | 'fi' | 'ja' | 'zh' | 'ko';

export interface Translations {
  // App
  appTitle: string;
  appSubtitle: string;

  // Navigation
  explore: string;
  login: string;
  logout: string;
  profile: string;
  backHome: string;

  // Story input
  storyInputPlaceholder: string;
  storyInputGuestPlaceholder: string;
  createStory: string;
  creating: string;

  // Generation progress
  creatingYourStory: string;
  generationFailed: string;
  generationCancelled: string;
  writingStory: string;
  drawingCharacters: string;
  illustratingPages: string;
  pages: string;
  pagesFailedCount: string;
  cancelGeneration: string;
  cancelConfirmTitle: string;
  cancelConfirmMessage: string;
  confirmCancel: string;
  keepGenerating: string;

  // Story card
  generatingStory: string;
  writingStoryStatus: string;
  drawingCharactersStatus: string;
  illustratingStatus: string;
  failed: string;
  creatingMagic: string;
  publicLabel: string;
  privateLabel: string;
  makePublic: string;
  makePrivate: string;
  deleteStory: string;

  // Story grid
  noStoriesYet: string;
  createFirstStory: string;

  // Story page
  storyNotFound: string;
  storyNotFoundDescription: string;
  storyDataUnavailable: string;
  reconnectedProgress: string;
  storyGeneratedSuccess: string;
  done: string;
  inProgress: string;
  imageCouldNotGenerate: string;
  imageNotAvailable: string;

  // Login
  loginTitle: string;
  loginSubtitle: string;
  email: string;
  password: string;
  signIn: string;
  signUp: string;
  forgotPassword: string;
  resetPasswordSent: string;
  noAccountYet: string;
  alreadyHaveAccount: string;
  orContinueWith: string;
  checkEmailForConfirmation: string;
  continueWithGoogle: string;
  finalizingAuth: string;
  authError: string;
  backToLogin: string;

  // Profile
  myStories: string;
  noStoriesYetProfile: string;
  createFirstStoryMagic: string;
  createAStory: string;
  user: string;

  // Explore
  exploreStories: string;
  discoverCommunityStories: string;
  searchStories: string;
  noPublicStoriesFound: string;
  tryDifferentSearch: string;
  noPublicStoriesYet: string;

  // Error boundary
  somethingWentWrong: string;
  unexpectedError: string;
  home: string;

  // Confirm dialogs
  confirmDeleteStory: string;
  couldNotDeleteStory: string;
  couldNotChangeVisibility: string;
  couldNotCreateStory: string;

  // Font size
  fontSize: string;
  fontSizeSmall: string;
  fontSizeMedium: string;
  fontSizeLarge: string;

  // Mobile menu
  menu: string;
  theme: string;

  // Language
  language: string;
  languageName: string;
}
