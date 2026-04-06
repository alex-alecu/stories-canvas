import type { Translations } from '../types';

const ro: Translations = {
  // App
  appTitle: 'Povești Magice',
  appSubtitle: 'Creează povești ilustrate magice pentru copiii tăi',

  // Navigation
  explore: 'Explorează',
  login: 'Conectare',
  logout: 'Deconectare',
  profile: 'Profil',
  backHome: 'Înapoi acasă',

  // Story input
  storyInputPlaceholder: "Descrie povestea ta... de exemplu, 'Un iepuraș curajos care descoperă o grădină magică în nori'",
  storyInputGuestPlaceholder: 'Trebuie să te conectezi pentru a crea povești',
  createStory: 'Creează Poveste',
  creating: 'Se creează...',
  childAge: 'Vârsta copilului',
  artStyle: 'Stil artistic',
  styleDisneyPixar: 'Disney/Pixar 3D',
  styleWatercolor: 'Acuarelă',
  styleStorybook: 'Carte clasică de povești',
  styleAnime: 'Anime',
  styleColoredPencil: 'Creioane colorate',
  stylePaperCutout: 'Colaj de hârtie',

  // Generation progress
  creatingYourStory: 'Se creează povestea ta',
  generationFailed: 'Generarea a eșuat',
  generationCancelled: 'Generarea a fost anulată',
  writingStory: 'Se scrie povestea',
  drawingCharacters: 'Se desenează personajele',
  illustratingPages: 'Se ilustrează paginile',
  pages: 'Pagini',
  pagesFailedCount: 'pagină/pagini nu s-au generat',
  cancelGeneration: 'Anulează',
  cancelConfirmTitle: 'Anulezi generarea?',
  cancelConfirmMessage: 'Ești sigur? Aceasta va opri generarea poveștii și o va șterge.',
  confirmCancel: 'Da, anulează',
  keepGenerating: 'Continuă generarea',

  // Story card
  generatingStory: 'Se generează povestea...',
  writingStoryStatus: 'Se scrie povestea...',
  drawingCharactersStatus: 'Se desenează personajele...',
  illustratingStatus: 'Se ilustrează...',
  failed: 'Eșuat',
  creatingMagic: 'Se creează magia...',
  publicLabel: 'Publică',
  privateLabel: 'Privată',
  makePublic: 'Fă publică',
  makePrivate: 'Fă privată',
  deleteAction: 'Șterge',
  deleteStory: 'Șterge povestea',

  // Story grid
  noStoriesYet: 'Nicio poveste încă',
  createFirstStory: 'Creează prima ta poveste mai sus!',

  // Story page
  storyNotFound: 'Povestea nu a fost găsită',
  storyNotFoundDescription: 'Această poveste a fost ștearsă sau nu există.',
  storyDataUnavailable: 'Datele poveștii nu sunt disponibile',
  reconnectedProgress: 'Reconectat la progresul generării...',
  storyGeneratedSuccess: 'Povestea a fost generată cu succes!',
  done: 'Gata!',
  inProgress: 'În progres...',
  imageCouldNotGenerate: 'Imaginea nu a putut fi generată',
  imageNotAvailable: 'Imaginea nu este disponibilă',

  // Login
  loginTitle: 'Conectare',
  loginSubtitle: 'Conectează-te pentru a crea și gestiona poveștile tale',
  email: 'Email',
  password: 'Parolă',
  signIn: 'Autentificare',
  signUp: 'Înregistrare',
  forgotPassword: 'Ai uitat parola?',
  resetPasswordSent: 'Email de resetare a parolei trimis. Verifică inbox-ul.',
  noAccountYet: 'Nu ai un cont?',
  alreadyHaveAccount: 'Ai deja un cont?',
  orContinueWith: 'sau continuă cu',
  checkEmailForConfirmation: 'Verifică email-ul pentru a confirma contul.',
  continueWithGoogle: 'Continuă cu Google',
  finalizingAuth: 'Se finalizează autentificarea...',
  authError: 'Autentificare eșuată',
  backToLogin: 'Înapoi la autentificare',

  // Profile
  myStories: 'Poveștile mele',
  noStoriesYetProfile: 'Nu ai nicio poveste încă',
  createFirstStoryMagic: 'Creează prima ta poveste magică!',
  createAStory: 'Creează o poveste',
  user: 'Utilizator',

  // Explore
  exploreStories: 'Explorează Povești',
  discoverCommunityStories: 'Descoperă povești create de comunitate',
  searchStories: 'Caută povești...',
  noPublicStoriesFound: 'Nicio poveste publică găsită',
  tryDifferentSearch: 'Încearcă un alt termen de căutare',
  noPublicStoriesYet: 'Nicio poveste publică încă',

  // Error boundary
  somethingWentWrong: 'Ceva nu a mers bine',
  unexpectedError: 'A apărut o eroare neașteptată',
  home: 'Acasă',

  // Confirm dialogs
  confirmDeleteStory: 'Ești sigur că vrei să ștergi această poveste?',
  couldNotDeleteStory: 'Nu s-a putut șterge povestea',
  couldNotChangeVisibility: 'Nu s-a putut schimba vizibilitatea poveștii',
  couldNotCreateStory: 'Nu s-a putut crea povestea. Te rugăm să încerci din nou.',

  // Language
  fontSize: 'Dimensiune font',
  fontSizeSmall: 'Mic',
  fontSizeMedium: 'Mediu',
  fontSizeLarge: 'Mare',

  menu: 'Meniu',
  theme: 'Temă',

  notificationTitle: 'Povestea ta este gata!',
  notificationBody: 'Prima ilustrație a fost generată. Vino să o vezi!',

  language: 'Limbă',
  languageName: 'Română',

  narratorVoice: 'Vocea naratorului',
  noVoice: 'Fara naratiune',
  voiceBunica: 'Bunica',
  voiceJora: 'Bunicul',
  voiceSerban: 'Tata',
  voiceCorina: 'Mama',
  voiceBunicaDesc: 'Caldă, iubitoare, calmă, lentă, în vârstă',
  voiceJoraDesc: 'Cald, iubitor, calm, lent, în vârstă',
  voiceSerbanDesc: 'Cald, iubitor, vesel, lent',
  voiceCorinaDesc: 'Caldă, iubitoare, veselă, lentă',
  recordingNarration: 'Inregistrare naratiune',
  narrationFailed: 'Naratiunea nu a putut fi generata',
  playNarration: 'Reda naratiunea',
  pauseNarration: 'Pauza naratiune',
  autoPlay: 'Redare automata',
  narrationSpeed: 'Viteză',

  storyTools: 'Instrumente poveste',
  reviewScript: 'Review script',
  reviewingScript: 'Reviewing script...',
  reviewingScriptStatus: 'Reviewing script...',
  reviewScriptDescription: 'Run an editorial review on the story script and auto-fix issues before you render again.',
  reviewScriptSuccess: 'Script review completed.',
  reviewScriptFailed: 'Script review failed. Please try again.',
  retry: 'Reîncearcă',
  back: 'Înapoi',
  retryDescription: 'Unele conținuturi nu au fost generate. Reîncearcă pentru a completa povestea.',
  failedImages: 'imagini eșuate',
  missingAudio: 'pagini fără audio',
  retrying: 'Se reîncearcă...',
  retrySuccess: 'Reîncercarea a reușit!',
  retryFailed: 'Reîncercarea a eșuat. Te rugăm să încerci din nou.',
  referenceImages: 'Imagini de referință',
  characterSheet: 'Fișa personajului',
  noReferenceImages: 'Nu sunt disponibile imagini de referință',
  storyStatus: 'Starea poveștii',
  retryingFailedIllustrations: 'Se reîncearcă {count} ilustrații eșuate...',
  generatingImageForPage: 'Se generează imaginea pentru pagina {pageNumber}...',
  blockedIllustrationsDescription: '{count} ilustrații nu au putut fi generate deoarece furnizorul de imagini le-a blocat sau respins. Deschide Instrumente poveste pentru a reîncerca acele pagini.',

  addNarration: 'Adaugă narațiune vocală acestei povești',
  selectVoice: 'Selectează vocea',
  generateNarration: 'Generează narațiunea',
  generatingNarration: 'Se generează narațiunea...',
  narrationSuccess: 'Narațiunea a fost generată cu succes!',
  narrationGenerationFailed: 'Generarea narațiunii a eșuat. Încearcă din nou.',

  assetsNeedRefresh: 'Assets need regeneration',
  regenerateAssets: 'Regenerate assets',
  regeneratingAssets: 'Regenerating assets...',
  regenerateAssetsDescription: 'This story was updated. Regenerate the illustrations and narration so they match the latest version.',
  regenerateAssetsFailed: 'Asset regeneration failed. Please try again.',
  storyIdeaButton: 'Inspiră-mă',
};

export default ro;
