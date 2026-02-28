import type { Translations } from '../types';

const ro: Translations = {
  // App
  appTitle: 'Povești Magice',
  appSubtitle: 'Creează povești ilustrate magice cu ajutorul AI',

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
};

export default ro;
