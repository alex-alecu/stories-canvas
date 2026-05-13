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
  childAge: string;
  artStyle: string;
  styleDisneyPixar: string;
  styleStorybook: string;
  styleAnime: string;
  styleColoredPencil: string;
  stylePaperCutout: string;

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
  downloadStory: string;
  downloadingStory: string;
  savedOffline: string;
  downloadFailed: string;
  retryDownload: string;
  keepOffline: string;
  removeFromDevice: string;
  viewsLabel: string;
  likeStory: string;
  dislikeStory: string;
  signInToReact: string;
  reactionUpdateFailed: string;
  dislikeFeedbackPlaceholder: string;
  submitDislikeFeedback: string;
  submittingDislikeFeedback: string;
  dislikeFeedbackTooLong: string;

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

  // Notifications
  notificationTitle: string;
  notificationBody: string;

  // Language
  language: string;
  languageName: string;

  // Voice narration
  narratorVoice: string;
  noVoice: string;
  voiceBunica: string;
  voiceJora: string;
  voiceSerban: string;
  voiceCorina: string;
  voiceBunicaDesc: string;
  voiceJoraDesc: string;
  voiceSerbanDesc: string;
  voiceCorinaDesc: string;
  recordingNarration: string;
  narrationFailed: string;
  playNarration: string;
  pauseNarration: string;
  autoPlay: string;
  narrationSpeed: string;

  // Story tools modal
  storyTools: string;
  reviewScript: string;
  reviewingScript: string;
  reviewingScriptStatus: string;
  reviewScriptDescription: string;
  reviewScriptSuccess: string;
  reviewScriptFailed: string;
  retry: string;
  back: string;
  retryDescription: string;
  failedImages: string;
  missingAudio: string;
  retrying: string;
  retrySuccess: string;
  retryFailed: string;
  referenceImages: string;
  characterSheet: string;
  noReferenceImages: string;
  storyStatus: string;
  retryingFailedIllustrations: string;
  generatingImageForPage: string;
  blockedIllustrationsDescription: string;
  storyToolsSectionStory: string;
  storyToolsSectionReading: string;
  storyToolsSectionCurrentPage: string;
  storyToolsCurrentPageCount: string;
  openCurrentPageImage: string;
  pageImageAlt: string;
  regeneratePageImageTitle: string;
  regeneratePageImageDescription: string;
  imageQualityMode: string;
  audioAndScriptTitle: string;
  audioAndScriptDescription: string;
  pageActionsAvailableAfterGeneration: string;
  signInAsOwnerToRecreatePage: string;
  addNarrationFirst: string;
  notEnoughCredits: string;
  openAction: string;
  feedbackLabel: string;
  pageImageFeedbackPlaceholder: string;
  pageImageFeedbackRequired: string;
  pageImageFeedbackTooLong: string;
  pageImageRegenerationError: string;
  costLabel: string;
  regenerating: string;
  regeneratingPageImage: string;
  pageImageRegenerationSuccess: string;
  pageImageRegenerationFailed: string;
  currentVoice: string;
  voiceLabel: string;
  sameVoice: string;
  pageTextLabel: string;
  pageTextValidationError: string;
  pageAudioUpdateError: string;
  updating: string;
  updatingScriptAndAudio: string;
  updateScriptAndAudio: string;
  scriptAndAudioUpdateSuccess: string;
  scriptAndAudioUpdateFailed: string;
  close: string;
  fullSizePreview: string;

  // Generate narration
  addNarration: string;
  selectVoice: string;
  generateNarration: string;
  generatingNarration: string;
  narrationSuccess: string;
  narrationGenerationFailed: string;
  assetsNeedRefresh: string;
  regenerateAssets: string;
  regeneratingAssets: string;
  regenerateAssetsDescription: string;
  regenerateAssetsFailed: string;

  // Story ideas
  storyIdeaButton: string;

  // Marketing consent
  marketingConsentTitle: string;
  marketingConsentBody: string;
  marketingConsentReject: string;
  marketingConsentAccept: string;

  // Billing and credits
  creditSingular: string;
  creditPlural: string;
  storyModeFast: string;
  storyModePro: string;
  storyModeProAudio: string;
  storyModeFastSummary: string;
  storyModeProSummary: string;
  storyModeProAudioSummary: string;
  creditsRequiredLabel: string;
  creditsAvailableLabel: string;
  getCredits: string;
  billingLabel: string;
  billingTitle: string;
  billingDescription: string;
  availableCredits: string;
  billingBannerCheckoutCompletedTitle: string;
  billingBannerCheckoutCompletedBody: string;
  billingBannerCheckoutCancelledTitle: string;
  billingBannerCheckoutCancelledBody: string;
  billingBannerMoreCreditsTitle: string;
  billingBannerMoreCreditsBody: string;
  billingStoryPacksTitle: string;
  billingStoryPacksDescription: string;
  billingRedirectingToStripe: string;
  billingBuyPack: string;
  billingUnavailable: string;
  billingCreationModesTitle: string;
  billingPurchasesTitle: string;
  billingNoPurchases: string;
  billingCreditHistoryTitle: string;
  billingNoCreditActivity: string;
  billingBalanceAfter: string;
  billingPending: string;
  billingStatusPending: string;
  billingStatusCompleted: string;
  billingStatusFailed: string;
  billingStatusProcessing: string;
  billingStatusProcessed: string;
  billingReasonPackPurchase: string;
  billingReasonStoryCreate: string;
  billingReasonStoryAddAudio: string;
  billingReasonStoryRegenerateAssets: string;
  billingReasonStoryRegenerateImage: string;
  billingReasonStoryRegenerateAudio: string;
  billingReasonStoryRefund: string;
  billingReasonAdminGrant: string;
  offerPack5Name: string;
  offerPack5Description: string;
  offerPack12Name: string;
  offerPack12Description: string;
  offerPack20Name: string;
  offerPack20Description: string;

  // Profile billing
  profileCreditsTitle: string;
  profileManageBilling: string;
  deviceDownloads: string;
  deviceDownloadsDescription: string;
  downloadedStories: string;
  manualDownloads: string;
  recentDownloads: string;
  storageUsed: string;
  deleteAllDownloads: string;
  deleteAllDownloadsTitle: string;
  deleteAllDownloadsDescription: string;
  confirmDeleteAllDownloads: string;
  noDeviceDownloads: string;
  couldNotUpdateDownloads: string;

  // Admin
  adminAccessRequiredTitle: string;
  adminAccessRequiredBody: string;
  adminLabel: string;
  adminTitle: string;
  adminDescription: string;
  adminSignedInAs: string;
  adminPackOffersTitle: string;
  adminOfferSaved: string;
  adminWebhookActivityTitle: string;
  adminNoWebhookEvents: string;
  adminUserSearchTitle: string;
  adminUserSearchPlaceholder: string;
  adminSearchingUsers: string;
  adminNoUsersFound: string;
  adminRole: string;
  adminSelectUser: string;
  adminLoadingUserDetails: string;
  adminJoined: string;
  adminGrantFreeCreditsTitle: string;
  adminLedgerReasonPlaceholder: string;
  adminGrantingCredits: string;
  adminGrantCredits: string;
  adminRecentPurchasesTitle: string;
  adminCreditLedgerTitle: string;
  adminNoLedgerEntries: string;
  adminOfferNameLabel: string;
  adminOfferDescriptionLabel: string;
  adminOfferPriceLabel: string;
  adminOfferActiveLabel: string;
  adminSaving: string;
  adminSaveOffer: string;
  adminNever: string;
}
