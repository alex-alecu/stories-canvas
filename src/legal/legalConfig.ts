import { legalCompany, legalContactEmail } from './companyConfig';

export type LegalProfileKey = 'ro' | 'en';

export type LegalRouteKey =
  | 'terms'
  | 'privacy'
  | 'cookies'
  | 'withdrawalRefunds'
  | 'consumerProtection'
  | 'contact';

export interface LegalOperator {
  name: string;
  legalForm: string;
  address: string;
  registrationNumber: string;
  euid: string;
  taxId: string;
  county: string;
  city: string;
  contactEmailLabel: string;
  website: string;
  jurisdiction: string;
}

export interface LegalLink {
  label: string;
  href: string;
  external?: boolean;
}

export interface FooterGroup {
  title: string;
  links: LegalLink[];
}

export interface LegalSection {
  heading: string;
  body?: string[];
  bullets?: string[];
  links?: LegalLink[];
  showCookieControls?: boolean;
}

export interface LegalDocument {
  route: string;
  title: string;
  description: string;
  updatedAt: string;
  updatedAtIso: string;
  sections: LegalSection[];
}

export interface LegalProfile {
  key: LegalProfileKey;
  domains: string[];
  localeLabel: string;
  updatedLabel: string;
  legalNavLabel: string;
  marketingConsentLabel: string;
  marketingConsentAcceptedLabel: string;
  marketingConsentRejectedLabel: string;
  marketingAcceptLabel: string;
  marketingRejectLabel: string;
  footerDescription: string;
  footerGroups: FooterGroup[];
  operator: LegalOperator;
  documents: Record<LegalRouteKey, LegalDocument>;
}

export const LEGAL_ROUTES: Record<LegalRouteKey, string> = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  cookies: '/legal/cookies',
  withdrawalRefunds: '/legal/withdrawal-refunds',
  consumerProtection: '/legal/consumer-protection',
  contact: '/legal/contact',
};

export function getObfuscatedEmailLabel(): string {
  const local = legalContactEmail.localParts.join(legalContactEmail.separator);
  const domain = legalContactEmail.domainParts.join(legalContactEmail.dotLabel);
  return `${local}${legalContactEmail.atLabel}${domain}`;
}

function getConfiguredWebsite(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.APP_BASE_URL || env?.PUBLIC_APP_URL || legalCompany.website;
}

function getConfiguredLegalLanguage(): LegalProfileKey {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const language = typeof window === 'undefined'
    ? processEnv?.APP_DEFAULT_LANGUAGE
    : env?.VITE_APP_DEFAULT_LANGUAGE || env?.VITE_DEFAULT_LANGUAGE;
  return language === 'en' ? 'en' : 'ro';
}

const roOperator: LegalOperator = {
  name: legalCompany.name,
  legalForm: legalCompany.legalForm,
  address: legalCompany.address,
  registrationNumber: legalCompany.registrationNumber,
  euid: legalCompany.euid,
  taxId: legalCompany.taxId,
  county: legalCompany.county,
  city: legalCompany.city,
  contactEmailLabel: getObfuscatedEmailLabel(),
  website: getConfiguredWebsite(),
  jurisdiction: legalCompany.jurisdiction,
};

const legalLinks = {
  terms: { label: 'Termeni și condiții', href: LEGAL_ROUTES.terms },
  privacy: { label: 'Confidențialitate', href: LEGAL_ROUTES.privacy },
  cookies: { label: 'Cookies', href: LEGAL_ROUTES.cookies },
  withdrawalRefunds: { label: 'Retragere și rambursări', href: LEGAL_ROUTES.withdrawalRefunds },
  consumerProtection: { label: 'ANPC / SAL', href: LEGAL_ROUTES.consumerProtection },
  contact: { label: 'Contact', href: LEGAL_ROUTES.contact },
  readingTogether: { label: 'Cum folosim poveștile', href: '/blog/cum-folosesti-povestile-pentru-copii' },
  storiesVsVideos: { label: 'Povești vs videoclipuri', href: '/blog/povesti-vs-videoclipuri-copii-sub-5-ani' },
  anpc: { label: 'ANPC', href: 'https://anpc.ro/', external: true },
  sal: { label: 'Reclamații SAL ANPC', href: 'https://reclamatiisal.anpc.ro/', external: true },
} satisfies Record<string, LegalLink>;

const enLegalLinks = {
  terms: { label: 'Terms', href: LEGAL_ROUTES.terms },
  privacy: { label: 'Privacy', href: LEGAL_ROUTES.privacy },
  cookies: { label: 'Cookies', href: LEGAL_ROUTES.cookies },
  withdrawalRefunds: { label: 'Withdrawal and refunds', href: LEGAL_ROUTES.withdrawalRefunds },
  consumerProtection: { label: 'Consumer protection', href: LEGAL_ROUTES.consumerProtection },
  contact: { label: 'Contact', href: LEGAL_ROUTES.contact },
  readingTogether: { label: 'Using stories with children', href: '/blog/how-to-use-childrens-stories' },
  storiesVsVideos: { label: 'Stories vs videos', href: '/blog/stories-vs-videos-for-children-under-5' },
  anpc: { label: 'ANPC', href: 'https://anpc.ro/', external: true },
  sal: { label: 'ANPC alternative dispute resolution', href: 'https://anpc.ro/sal/', external: true },
} satisfies Record<string, LegalLink>;

function document(
  key: LegalRouteKey,
  title: string,
  description: string,
  sections: LegalSection[],
  updatedAt = '5 iunie 2026',
): LegalDocument {
  return {
    route: LEGAL_ROUTES[key],
    title,
    description,
    updatedAt,
    updatedAtIso: '2026-06-05',
    sections,
  };
}

function enDocument(
  key: LegalRouteKey,
  title: string,
  description: string,
  sections: LegalSection[],
): LegalDocument {
  return document(key, title, description, sections, '5 June 2026');
}

const roDocuments: Record<LegalRouteKey, LegalDocument> = {
  terms: document('terms', 'Termeni și condiții', 'Regulile de utilizare pentru Povești Magice.', [
    {
      heading: '1. Operatorul serviciului',
      body: [
        'Serviciul Povești Magice este operat de {operator.name} {operator.legalForm}, cu sediul în {operator.address}, înregistrată la Registrul Comerțului sub nr. {operator.registrationNumber}, EUID {operator.euid}, CUI {operator.taxId}.',
        'Contactul principal pentru utilizatori este {operator.contactEmailLabel}. Pentru solicitări legate de cont, plăți, credite, conținut generat sau date personale, folosiți această adresă de contact.',
      ],
    },
    {
      heading: '2. Descrierea serviciului',
      body: [
        'Povești Magice este o aplicație online care permite utilizatorilor să creeze povești ilustrate pentru copii pornind de la o idee, o vârstă țintă, o limbă și un stil vizual. În funcție de opțiunile alese, serviciul poate genera text, imagini și narațiune audio.',
        'Conținutul este produs cu ajutorul unor sisteme automate de inteligență artificială. Rezultatele pot conține erori, omisiuni, formulări nepotrivite sau diferențe față de instrucțiunile introduse. Utilizatorul trebuie să revizuiască povestea înainte de a o citi unui copil sau de a o distribui.',
      ],
    },
    {
      heading: '3. Conturi și acces',
      body: [
        'Pentru crearea, salvarea și administrarea poveștilor este necesar un cont. Utilizatorul este responsabil pentru acuratețea informațiilor furnizate, păstrarea confidențialității datelor de autentificare și activitatea desfășurată prin contul său.',
        'Putem limita, suspenda sau închide accesul dacă observăm utilizare abuzivă, încălcarea acestor termeni, încercări de fraudă, riscuri de securitate sau conținut care poate afecta alți utilizatori ori funcționarea serviciului.',
      ],
    },
    {
      heading: '4. Credite, prețuri și plăți',
      body: [
        'Serviciul folosește credite pentru generarea poveștilor și pentru acțiuni suplimentare, cum ar fi regenerarea imaginilor sau adăugarea narațiunii audio. Numărul de credite necesare este afișat în aplicație înainte de inițierea acțiunii.',
        'Prețurile pachetelor de credite sunt afișate înainte de trimiterea utilizatorului către plata online. Plățile sunt procesate prin Stripe. Povești Magice nu stochează datele complete ale cardului. Confirmarea plății, alocarea creditelor și actualizarea istoricului pot depinde de mesajele primite de la procesatorul de plată.',
        'Creditele nu sunt monedă electronică, nu produc dobândă și pot fi folosite doar în cadrul serviciului Povești Magice. Dacă un pachet sau o funcționalitate este indisponibilă temporar, vom depune eforturi rezonabile pentru remediere sau pentru clarificarea situației prin suport.',
      ],
    },
    {
      heading: '5. Conținutul utilizatorului',
      body: [
        'Utilizatorul este responsabil pentru ideile, textele, numele și instrucțiunile introduse în serviciu. Nu este permisă introducerea de conținut ilegal, discriminatoriu, violent, sexual explicit, defăimător, care încalcă drepturile altor persoane sau care nu este potrivit pentru un serviciu destinat familiilor.',
        'Prin trimiterea unei idei sau a unor instrucțiuni, utilizatorul ne acordă permisiunea de a le prelucra pentru generarea, afișarea, stocarea și administrarea poveștii solicitate. Această permisiune este necesară pentru executarea serviciului.',
        'Dacă marcați o poveste ca publică, aceasta poate fi afișată altor utilizatori în zona de explorare. Puteți reveni asupra vizibilității din aplicație, acolo unde această funcție este disponibilă.',
      ],
    },
    {
      heading: '6. Utilizare acceptabilă',
      bullets: [
        'Nu folosiți serviciul pentru conținut ilegal, hărțuire, fraudă, exploatarea minorilor, încălcarea drepturilor de autor sau încălcarea drepturilor la imagine și viață privată.',
        'Nu încercați să ocoliți limitele tehnice, mecanismele de plată, filtrele de siguranță, autentificarea sau restricțiile de acces.',
        'Nu încărcați date personale sensibile ale copiilor sau ale altor persoane decât dacă aveți dreptul legal și un motiv real să faceți acest lucru.',
        'Nu folosiți rezultatele generate ca recomandări medicale, juridice, psihologice sau educaționale specializate.',
      ],
    },
    {
      heading: '7. Disponibilitate și modificări',
      body: [
        'Depunem eforturi rezonabile pentru ca serviciul să fie disponibil, dar nu garantăm funcționarea neîntreruptă sau lipsită de erori. Furnizorii terți, mentenanța, incidentele tehnice, limitele de capacitate sau restricțiile de securitate pot afecta temporar serviciul.',
        'Putem modifica funcționalitățile, prețurile, pachetele de credite sau acești termeni. Versiunea aplicabilă este cea publicată în această pagină la momentul utilizării serviciului, fără a afecta drepturile obligatorii ale consumatorilor.',
      ],
    },
    {
      heading: '8. Răspundere, consumatori și lege aplicabilă',
      body: [
        'Serviciul este furnizat pentru uz personal și familial. În limitele permise de lege, nu răspundem pentru pierderi indirecte, utilizări nepotrivite ale conținutului generat sau decizii luate exclusiv pe baza rezultatului automat.',
        'Dacă sunteți consumator, beneficiați de drepturile obligatorii prevăzute de legislația privind protecția consumatorilor. Acești termeni sunt guvernați de legea română, fără a limita drepturile imperative conferite de legislația aplicabilă.',
      ],
      links: [
        { label: 'Legea 365/2002 privind comerțul electronic', href: 'https://legislatie.just.ro/public/DetaliiDocument/77218', external: true },
        { label: 'OUG 34/2014 privind contractele la distanță', href: 'https://legislatie.just.ro/Public/DetaliiDocument/158913', external: true },
      ],
    },
  ]),
  privacy: document('privacy', 'Politica de confidențialitate', 'Cum colectăm, folosim și protejăm datele personale în Povești Magice.', [
    {
      heading: '1. Operatorul de date',
      body: [
        'Operatorul datelor personale este {operator.name} {operator.legalForm}, cu sediul în {operator.address}. Pentru întrebări privind datele personale ne puteți scrie la adresa de contact afișată în pagina Contact.',
        'Această politică explică prelucrările realizate prin website-ul și aplicația Povești Magice, inclusiv crearea contului, generarea poveștilor, afișarea poveștilor publice, plățile pentru credite și funcțiile offline.',
      ],
    },
    {
      heading: '2. Date pe care le prelucrăm',
      bullets: [
        'Date de cont: email, identificator de utilizator, nume și avatar dacă le primim de la furnizorul de autentificare, preferința de limbă și informații despre roluri administrative, dacă este cazul.',
        'Date despre povești: ideea introdusă, vârsta copilului, limba, stilul vizual, modul de generare, vocea aleasă, scenariul, textul paginilor, descrierile de imagine, imaginile generate, audio-ul generat și starea generării.',
        'Date despre folosirea aplicației: povești create, povești marcate publice/private, reacții like/dislike, feedback pentru imagini, descărcări offline pe dispozitiv și jurnal de consum al creditelor.',
        'Date de plată: pachetul de credite cumpărat, suma, moneda, statusul plății, identificatori de sesiune Stripe și istoricul creditelor. Datele complete ale cardului sunt procesate de Stripe, nu de Povești Magice.',
        'Date tehnice și de securitate: adresa IP, user-agent, loguri de cereri, evenimente de eroare, limite de rată, identificatori necesari autentificării și date stocate local pentru funcționarea aplicației.',
        'Date de marketing: parametri UTM, identificatori de campanie și evenimente de conversie numai dacă acceptați tehnologiile de marketing.',
      ],
    },
    {
      heading: '3. Scopuri și temeiuri juridice',
      bullets: [
        'Executarea contractului: crearea contului, generarea și afișarea poveștilor, salvarea materialelor, administrarea creditelor, descărcările offline și livrarea funcțiilor cerute de utilizator.',
        'Obligații legale: evidența tranzacțiilor, răspunsul la solicitări legale, obligații fiscale, protecția consumatorilor și păstrarea documentelor cerute de lege.',
        'Interes legitim: securitatea serviciului, prevenirea fraudelor și abuzului, depanarea erorilor, protejarea infrastructurii, analiză agregată de funcționare și comunicări strict operaționale.',
        'Consimțământ: marketing, pixeli publicitari, măsurarea conversiilor și comunicări promoționale atunci când sunt activate explicit.',
      ],
    },
    {
      heading: '4. Furnizori și destinatari',
      body: [
        'Pentru funcționarea website-ului folosim furnizori tehnici, precum servicii de autentificare, bază de date și stocare, procesare plăți, generare AI text/imagine/audio, găzduire, monitorizare, suport și marketing. Furnizorii primesc doar datele necesare rolului lor.',
        'În configurația actuală a produsului pot fi folosite categorii precum Supabase pentru autentificare, bază de date și stocare, Stripe pentru plăți, furnizori AI pentru generarea textului și imaginilor, ElevenLabs pentru narațiune audio dacă alegeți această funcție, și Google/Meta/TikTok pentru marketing numai după consimțământ.',
        'Datele pot fi transferate în afara Spațiului Economic European dacă furnizorii noștri operează global. În aceste cazuri folosim mecanismele contractuale și măsurile de protecție disponibile conform GDPR.',
      ],
    },
    {
      heading: '5. Povești publice și conținut generat',
      body: [
        'Poveștile sunt private în mod implicit, cu excepția cazului în care alegeți să le faceți publice. O poveste publică poate fi afișată în secțiunea de explorare și poate fi văzută de alți utilizatori sau vizitatori.',
        'Nu introduceți în prompturi date personale sensibile, date de identificare ale copiilor, adrese, informații medicale sau alte informații pe care nu doriți să fie prelucrate de serviciu și de furnizorii tehnici necesari generării.',
      ],
    },
    {
      heading: '6. Durata de păstrare',
      body: [
        'Păstrăm datele contului și poveștile cât timp contul este activ sau cât este necesar pentru furnizarea serviciului. Utilizatorul poate șterge anumite povești din aplicație, iar datele salvate offline pot rămâne pe dispozitiv până când sunt eliminate local.',
        'Datele de plată, evidență contabilă, securitate și suport pot fi păstrate mai mult dacă legea o cere sau dacă avem nevoie să protejăm drepturile noastre, ale utilizatorilor sau ale terților.',
      ],
    },
    {
      heading: '7. Drepturile persoanelor vizate',
      body: [
        'Aveți dreptul de acces, rectificare, ștergere, restricționare, portabilitate, opoziție și retragere a consimțământului, în condițiile GDPR. Puteți trimite solicitări folosind adresa de contact afișată în pagina Contact.',
        'Vom răspunde solicitărilor în termenul prevăzut de GDPR. Pentru a proteja contul, putem cere informații rezonabile pentru verificarea identității înainte de a executa o cerere.',
        'Aveți dreptul să depuneți o plângere la Autoritatea Națională de Supraveghere a Prelucrării Datelor cu Caracter Personal dacă apreciați că drepturile dumneavoastră au fost încălcate.',
      ],
      links: [
        { label: 'ANSPDCP', href: 'https://www.dataprotection.ro/', external: true },
        { label: 'GDPR Articolul 13', href: 'https://eur-lex.europa.eu/eli/reg/2016/679/art_13/oj/eng', external: true },
      ],
    },
  ]),
  cookies: document('cookies', 'Politica de cookies', 'Informații despre stocarea locală și tehnologiile de marketing folosite de Povești Magice.', [
    {
      heading: '1. Ce folosim',
      body: [
        'Povești Magice folosește cookie-uri, localStorage, IndexedDB și cache de browser/service worker pentru autentificare, preferințe, funcționare offline, securitate și memorarea consimțământului.',
        'Cookie-urile sau pixelii de marketing sunt încărcați numai după acceptarea explicită în bannerul de consimțământ sau prin controalele de pe această pagină.',
      ],
    },
    {
      heading: '2. Categorii',
      bullets: [
        'Strict necesare: autentificare, sesiune, securitate, prevenirea abuzului, funcționarea aplicației și încărcarea paginilor.',
        'Preferințe: limba, tema, dimensiunea fontului, povestea aflată în generare și alte setări de interfață.',
        'Offline și performanță: povești descărcate pe dispozitiv, imagini/audio salvate local, cache de service worker și date necesare pentru citirea offline.',
        'Marketing opțional: Google Tag Manager/Google Analytics/Google Ads, Meta Pixel sau TikTok Pixel, doar dacă sunt configurate și dacă ați acceptat consimțământul.',
      ],
    },
    {
      heading: '3. Schimbarea consimțământului',
      showCookieControls: true,
      body: [
        'Puteți modifica opțiunea de marketing din această pagină. Refuzul cookie-urilor de marketing nu blochează folosirea aplicației, dar poate limita măsurarea conversiilor și eficiența reclamelor.',
      ],
    },
    {
      heading: '4. Control din browser',
      body: [
        'Puteți șterge cookie-urile și datele locale și din setările browserului. Dacă ștergeți datele locale, unele preferințe, starea consimțământului sau poveștile salvate offline pot fi pierdute.',
        'Pentru că folosim și tehnologii similare cookie-urilor, precum pixeli, identificatori de conversie și stocare locală, această politică se aplică tuturor tehnologiilor care citesc sau salvează informații pe dispozitiv.',
      ],
      links: [
        { label: 'EDPB despre tehnici de tracking și ePrivacy', href: 'https://www.edpb.europa.eu/news/news/2023/edpb-provides-clarity-tracking-techniques-covered-eprivacy-directive_en', external: true },
      ],
    },
  ]),
  withdrawalRefunds: document('withdrawalRefunds', 'Retragere și rambursări', 'Drepturi de retragere, conținut digital și rambursări pentru creditele Povești Magice.', [
    {
      heading: '1. Dreptul de retragere',
      body: [
        'Consumatorii beneficiază, în principiu, de un termen de 14 zile pentru retragerea din contractele la distanță, conform legislației aplicabile.',
        'Povești Magice furnizează servicii și conținut digital personalizat, livrat fără suport material: povești, imagini și narațiuni audio generate la cererea utilizatorului. Pentru acest tip de conținut, dreptul de retragere poate fi limitat sau pierdut după începerea prestării cu acordul expres al consumatorului și după confirmarea faptului că înțelege consecința asupra dreptului de retragere.',
      ],
    },
    {
      heading: '2. Când începe prestarea',
      body: [
        'Prestarea începe atunci când utilizatorul cere efectiv generarea unei povești, regenerarea unei imagini, actualizarea unui text sau generarea unei narațiuni audio. Din acel moment, sistemele automate pot consuma resurse ale furnizorilor AI și pot produce conținut personalizat.',
        'Înainte de cumpărarea creditelor sau de consumarea lor, aplicația afișează informații despre pachet, costurile în credite și acțiunea inițiată. Utilizatorul trebuie să verifice selecțiile înainte de confirmare.',
      ],
    },
    {
      heading: '3. Rambursări automate de credite',
      body: [
        'Aplicația poate rambursa automat credite în anumite cazuri tehnice, de exemplu când o generare este anulată sau eșuează înainte ca materialul să fie salvat conform regulilor implementate în serviciu.',
        'Pentru unele acțiuni, dacă o imagine, un audio sau un material regenerat nu se salvează, aplicația poate marca rambursarea creditelor în istoricul contului. Acest mecanism privește creditele din aplicație și nu înlocuiește drepturile legale ale consumatorului.',
      ],
    },
    {
      heading: '4. Rambursări de bani',
      body: [
        'Pentru probleme de plată, dublă taxare, creditare incorectă, tranzacții neautorizate sau solicitări comerciale, contactați-ne folosind adresa afișată în pagina Contact. Includeți emailul contului, data plății, suma, pachetul cumpărat și detaliile problemei.',
        'Dacă rambursarea unei plăți este aprobată, aceasta se procesează prin Stripe sau prin canalul de plată folosit. Timpul până la apariția banilor în cont poate depinde de bancă și de procesatorul de plată.',
      ],
      links: [
        { label: 'OUG 34/2014 privind contractele la distanță', href: 'https://legislatie.just.ro/Public/DetaliiDocument/158913', external: true },
      ],
    },
  ]),
  consumerProtection: document('consumerProtection', 'Protecția consumatorilor ANPC / SAL', 'Informații pentru consumatori și soluționarea alternativă a litigiilor.', [
    {
      heading: '1. Contactați-ne mai întâi',
      body: [
        'Pentru orice problemă legată de cont, generarea poveștilor, credite, plăți sau conținut generat, vă rugăm să ne contactați mai întâi folosind adresa afișată în pagina Contact. Vom încerca să răspundem și să găsim o soluție amiabilă într-un termen rezonabil.',
        'Aceeași adresă poate fi folosită pentru solicitări de plată, rambursare, confidențialitate și GDPR.',
      ],
    },
    {
      heading: '2. ANPC și SAL',
      body: [
        'Consumatorii din România se pot adresa Autorității Naționale pentru Protecția Consumatorilor și pot folosi mecanismele de Soluționare Alternativă a Litigiilor administrate prin ANPC.',
        'Procedura SAL este un mecanism extrajudiciar prin care consumatorii și profesioniștii pot încerca rezolvarea amiabilă a litigiilor rezultate din contracte de vânzare sau prestări de servicii.',
        'Nu includem link către fosta platformă europeană SOL/ODR, deoarece platforma și obligațiile aferente au fost eliminate începând cu 20 iulie 2025. Pentru România, folosim linkurile ANPC/SAL actuale.',
      ],
      links: [
        legalLinks.anpc,
        { label: 'SAL ANPC', href: 'https://anpc.ro/sal/', external: true },
        legalLinks.sal,
        { label: 'ANPC despre actualizarea cadrului SAL', href: 'https://anpc.ro/anpc-dezvolta-sistemul-sal-potrivit-cadrului-european-actual/', external: true },
      ],
    },
  ]),
  contact: document('contact', 'Contact', 'Datele operatorului și canalele de suport pentru Povești Magice.', [
    {
      heading: '1. Date operator',
      bullets: [
        'Denumire: {operator.name} {operator.legalForm}',
        'Sediu: {operator.address}',
        'Registrul Comerțului: {operator.registrationNumber}',
        'EUID: {operator.euid}',
        'Cod fiscal: {operator.taxId}',
        'Județ: {operator.county}',
        'Localitate: {operator.city}',
        'Website: {operator.website}',
      ],
    },
    {
      heading: '2. Canale de contact',
      bullets: [
        'Suport general, plăți, credite, facturare, confidențialitate și GDPR: {operator.contactEmailLabel}',
      ],
    },
    {
      heading: '3. Ce să includeți în mesaj',
      bullets: [
        'Pentru probleme de generare: emailul contului, titlul sau ID-ul poveștii, momentul aproximativ și descrierea erorii.',
        'Pentru probleme de plată: emailul contului, pachetul cumpărat, data plății, suma și orice identificator primit de la Stripe sau bancă.',
        'Pentru cereri GDPR: dreptul pe care doriți să îl exercitați și date suficiente pentru identificarea contului.',
      ],
    },
  ]),
};

const enDocuments: Record<LegalRouteKey, LegalDocument> = {
  terms: enDocument('terms', 'Terms and conditions', 'The rules for using Magic Stories.', [
    {
      heading: '1. Service operator',
      body: [
        'Magic Stories is operated by {operator.name} {operator.legalForm}, with registered office at {operator.address}, registered with the Trade Register under no. {operator.registrationNumber}, EUID {operator.euid}, tax ID {operator.taxId}.',
        'The main user contact address is {operator.contactEmailLabel}. Use this address for account, payment, credit, generated content, or personal-data requests.',
      ],
    },
    {
      heading: '2. Service description',
      body: [
        'Magic Stories is an online application that lets users create illustrated children\'s stories from an idea, target age, language, and visual style. Depending on the selected options, the service may generate text, images, and audio narration.',
        'Content is produced with automated artificial-intelligence systems. Results may contain errors, omissions, unsuitable wording, or differences from the submitted instructions. Users should review a story before reading it to a child or sharing it.',
      ],
    },
    {
      heading: '3. Accounts and access',
      body: [
        'An account is required to create, save, and manage stories. Users are responsible for the accuracy of the information they provide, for keeping login details confidential, and for activity performed through their account.',
        'We may limit, suspend, or close access if we observe abusive use, breach of these terms, fraud attempts, security risks, or content that may affect other users or service operation.',
      ],
    },
    {
      heading: '4. Credits, prices, and payments',
      body: [
        'The service uses credits for story generation and additional actions such as image regeneration or audio narration. The required number of credits is shown in the application before the action starts.',
        'Credit pack prices are shown before the user is redirected to online payment. Payments are processed by Stripe. Magic Stories does not store complete card details. Payment confirmation, credit allocation, and history updates may depend on messages received from the payment processor.',
        'Credits are not electronic money, do not accrue interest, and can be used only inside Magic Stories. If a pack or feature is temporarily unavailable, we will make reasonable efforts to fix the issue or clarify it through support.',
      ],
    },
    {
      heading: '5. User content',
      body: [
        'Users are responsible for the ideas, text, names, and instructions they enter into the service. It is not permitted to submit illegal, discriminatory, violent, sexually explicit, defamatory content, content that infringes others\' rights, or content unsuitable for a family-oriented service.',
        'By submitting an idea or instructions, users allow us to process them to generate, display, store, and manage the requested story. This permission is necessary to provide the service.',
        'If you mark a story as public, it may be displayed to other users in the exploration area. You can change visibility from the application where this feature is available.',
      ],
    },
    {
      heading: '6. Acceptable use',
      bullets: [
        'Do not use the service for illegal content, harassment, fraud, exploitation of minors, copyright infringement, or violations of image and privacy rights.',
        'Do not try to bypass technical limits, payment mechanisms, safety filters, authentication, or access restrictions.',
        'Do not enter sensitive personal data about children or other people unless you have a legal right and a real reason to do so.',
        'Do not treat generated results as medical, legal, psychological, or specialized educational advice.',
      ],
    },
    {
      heading: '7. Availability and changes',
      body: [
        'We make reasonable efforts to keep the service available, but we do not guarantee uninterrupted or error-free operation. Third-party providers, maintenance, technical incidents, capacity limits, or security restrictions may temporarily affect the service.',
        'We may change features, prices, credit packs, or these terms. The applicable version is the one published on this page when the service is used, without limiting mandatory consumer rights.',
      ],
    },
    {
      heading: '8. Liability, consumers, and governing law',
      body: [
        'The service is provided for personal and family use. To the extent permitted by law, we are not liable for indirect losses, inappropriate use of generated content, or decisions made solely on the basis of automated output.',
        'If you are a consumer, you benefit from mandatory rights under consumer-protection law. These terms are governed by Romanian law, without limiting mandatory rights granted by applicable law.',
      ],
      links: [
        { label: 'Romanian Law 365/2002 on electronic commerce', href: 'https://legislatie.just.ro/public/DetaliiDocument/77218', external: true },
        { label: 'Romanian GEO 34/2014 on distance contracts', href: 'https://legislatie.just.ro/Public/DetaliiDocument/158913', external: true },
      ],
    },
  ]),
  privacy: enDocument('privacy', 'Privacy policy', 'How we collect, use, and protect personal data in Magic Stories.', [
    {
      heading: '1. Data controller',
      body: [
        'The personal-data controller is {operator.name} {operator.legalForm}, with registered office at {operator.address}. For personal-data questions, write to the contact address shown on the Contact page.',
        'This policy explains processing carried out through the Magic Stories website and app, including account creation, story generation, public story display, credit payments, and offline features.',
      ],
    },
    {
      heading: '2. Data we process',
      bullets: [
        'Account data: email, user identifier, name and avatar if received from an authentication provider, language preference, and administrative role information if applicable.',
        'Story data: submitted idea, child age, language, visual style, generation mode, selected voice, scenario, page text, image descriptions, generated images, generated audio, and generation status.',
        'Usage data: created stories, public/private visibility, like/dislike reactions, image feedback, offline downloads on the device, and credit-consumption history.',
        'Payment data: purchased credit pack, amount, currency, payment status, Stripe session identifiers, and credit history. Complete card data is processed by Stripe, not by Magic Stories.',
        'Technical and security data: IP address, user agent, request logs, error events, rate limits, authentication identifiers, and local data required for app operation.',
        'Marketing data: UTM parameters, campaign identifiers, and conversion events only if you accept marketing technologies.',
      ],
    },
    {
      heading: '3. Purposes and legal bases',
      bullets: [
        'Contract performance: account creation, story generation and display, material storage, credit management, offline downloads, and delivery of requested features.',
        'Legal obligations: transaction records, responses to legal requests, tax obligations, consumer protection, and records required by law.',
        'Legitimate interest: service security, fraud and abuse prevention, debugging, infrastructure protection, aggregate operational analytics, and strictly operational communications.',
        'Consent: marketing, advertising pixels, conversion measurement, and promotional communications when explicitly enabled.',
      ],
    },
    {
      heading: '4. Providers and recipients',
      body: [
        'We use technical providers for authentication, database and storage, payment processing, AI text/image/audio generation, hosting, monitoring, support, and marketing. Providers receive only the data needed for their role.',
        'The current product setup may use Supabase for authentication, database, and storage; Stripe for payments; AI providers for text and image generation; ElevenLabs for audio narration if selected; and Google/Meta/TikTok for marketing only after consent.',
        'Data may be transferred outside the European Economic Area if our providers operate globally. In those cases we use available contractual mechanisms and safeguards under GDPR.',
      ],
    },
    {
      heading: '5. Public stories and generated content',
      body: [
        'Stories are private by default unless you choose to make them public. A public story may be displayed in the exploration section and may be seen by other users or visitors.',
        'Do not enter sensitive personal data, identifying details about children, addresses, medical information, or any information you do not want processed by the service and the technical providers required for generation.',
      ],
    },
    {
      heading: '6. Retention',
      body: [
        'We keep account data and stories while the account is active or as needed to provide the service. Users may delete certain stories from the app, and offline data may remain on a device until removed locally.',
        'Payment, accounting, security, and support data may be kept longer where required by law or where needed to protect our rights, users, or third parties.',
      ],
    },
    {
      heading: '7. Data-subject rights',
      body: [
        'You have rights of access, rectification, erasure, restriction, portability, objection, and withdrawal of consent under GDPR. Send requests using the contact address shown on the Contact page.',
        'We will respond within the GDPR deadline. To protect accounts, we may request reasonable information to verify identity before fulfilling a request.',
        'You may lodge a complaint with the Romanian data-protection authority if you believe your rights were infringed.',
      ],
      links: [
        { label: 'ANSPDCP', href: 'https://www.dataprotection.ro/', external: true },
        { label: 'GDPR Article 13', href: 'https://eur-lex.europa.eu/eli/reg/2016/679/art_13/oj/eng', external: true },
      ],
    },
  ]),
  cookies: enDocument('cookies', 'Cookie policy', 'Information about local storage and marketing technologies used by Magic Stories.', [
    {
      heading: '1. What we use',
      body: [
        'Magic Stories uses cookies, localStorage, IndexedDB, and browser/service-worker cache for authentication, preferences, offline operation, security, and remembering consent.',
        'Marketing cookies or pixels load only after explicit acceptance in the consent banner or through the controls on this page.',
      ],
    },
    {
      heading: '2. Categories',
      bullets: [
        'Strictly necessary: authentication, session, security, abuse prevention, app operation, and page loading.',
        'Preferences: language, theme, font size, the story currently being generated, and other interface settings.',
        'Offline and performance: stories downloaded to the device, locally saved images/audio, service-worker cache, and data needed for offline reading.',
        'Optional marketing: Google Tag Manager/Google Analytics/Google Ads, Meta Pixel, or TikTok Pixel only if configured and accepted.',
      ],
    },
    {
      heading: '3. Changing consent',
      showCookieControls: true,
      body: [
        'You can change the marketing option from this page. Rejecting marketing cookies does not block app use, but it may limit conversion measurement and advertising effectiveness.',
      ],
    },
    {
      heading: '4. Browser control',
      body: [
        'You can also delete cookies and local data from browser settings. If local data is deleted, some preferences, consent state, or offline stories may be lost.',
        'Because we also use cookie-like technologies such as pixels, conversion identifiers, and local storage, this policy applies to all technologies that read or save information on the device.',
      ],
      links: [
        { label: 'EDPB on tracking techniques and ePrivacy', href: 'https://www.edpb.europa.eu/news/news/2023/edpb-provides-clarity-tracking-techniques-covered-eprivacy-directive_en', external: true },
      ],
    },
  ]),
  withdrawalRefunds: enDocument('withdrawalRefunds', 'Withdrawal and refunds', 'Withdrawal rights, digital content, and refunds for Magic Stories credits.', [
    {
      heading: '1. Right of withdrawal',
      body: [
        'Consumers generally have a 14-day withdrawal period for distance contracts under applicable law.',
        'Magic Stories supplies personalized services and digital content delivered without a physical medium: stories, images, and audio narration generated at the user\'s request. For this type of content, the withdrawal right may be limited or lost after performance begins with the consumer\'s express consent and confirmation that they understand the consequence for the withdrawal right.',
      ],
    },
    {
      heading: '2. When performance begins',
      body: [
        'Performance begins when the user requests story generation, image regeneration, text update, or audio narration. From that moment, automated systems may consume AI-provider resources and produce personalized content.',
        'Before buying or spending credits, the app displays information about the pack, credit cost, and initiated action. Users should check their selections before confirming.',
      ],
    },
    {
      heading: '3. Automatic credit refunds',
      body: [
        'The app may automatically refund credits in certain technical cases, such as when a generation is cancelled or fails before material is saved according to the service rules.',
        'For some actions, if an image, audio clip, or regenerated material is not saved, the app may record a credit refund in the account history. This mechanism concerns in-app credits and does not replace statutory consumer rights.',
      ],
    },
    {
      heading: '4. Money refunds',
      body: [
        'For payment problems, duplicate charges, incorrect crediting, unauthorized transactions, or commercial requests, contact us using the address shown on the Contact page. Include the account email, payment date, amount, purchased pack, and problem details.',
        'If a payment refund is approved, it is processed through Stripe or the payment channel used. The time until funds appear in the account may depend on the bank and processor.',
      ],
      links: [
        { label: 'Romanian GEO 34/2014 on distance contracts', href: 'https://legislatie.just.ro/Public/DetaliiDocument/158913', external: true },
      ],
    },
  ]),
  consumerProtection: enDocument('consumerProtection', 'Consumer protection / ADR', 'Information for consumers and alternative dispute resolution.', [
    {
      heading: '1. Contact us first',
      body: [
        'For any issue related to account access, story generation, credits, payments, or generated content, please contact us first using the address shown on the Contact page. We will try to respond and find an amicable solution within a reasonable time.',
        'The same address can be used for payment, refund, privacy, and GDPR requests.',
      ],
    },
    {
      heading: '2. ANPC and ADR',
      body: [
        'Consumers in Romania may contact the National Authority for Consumer Protection and may use alternative dispute resolution mechanisms administered through ANPC.',
        'ADR is an out-of-court mechanism through which consumers and professionals can try to resolve disputes arising from sales or service contracts amicably.',
        'We do not link to the former European ODR platform because the platform and related obligations were removed starting 20 July 2025. For Romania, we use the current ANPC/ADR links.',
      ],
      links: [
        enLegalLinks.anpc,
        enLegalLinks.sal,
        { label: 'ANPC on ADR framework updates', href: 'https://anpc.ro/anpc-dezvolta-sistemul-sal-potrivit-cadrului-european-actual/', external: true },
      ],
    },
  ]),
  contact: enDocument('contact', 'Contact', 'Operator details and support channels for Magic Stories.', [
    {
      heading: '1. Operator details',
      bullets: [
        'Name: {operator.name} {operator.legalForm}',
        'Registered office: {operator.address}',
        'Trade Register: {operator.registrationNumber}',
        'EUID: {operator.euid}',
        'Tax ID: {operator.taxId}',
        'County: {operator.county}',
        'City: {operator.city}',
        'Website: {operator.website}',
      ],
    },
    {
      heading: '2. Contact channels',
      bullets: [
        'General support, payments, credits, billing, privacy, and GDPR: {operator.contactEmailLabel}',
      ],
    },
    {
      heading: '3. What to include',
      bullets: [
        'For generation issues: account email, story title or ID, approximate time, and error description.',
        'For payment issues: account email, purchased pack, payment date, amount, and any identifier received from Stripe or the bank.',
        'For GDPR requests: the right you want to exercise and enough information to identify the account.',
      ],
    },
  ]),
};

export const legalProfiles: Record<LegalProfileKey, LegalProfile> = {
  ro: {
    key: 'ro',
    domains: ['basmul.ro', 'www.basmul.ro', 'povestimagice.ro', 'www.povestimagice.ro', 'localhost', '127.0.0.1'],
    localeLabel: 'Romania',
    updatedLabel: 'Actualizat',
    legalNavLabel: 'Legal',
    marketingConsentLabel: 'Consimțământ marketing',
    marketingConsentAcceptedLabel: 'acceptat',
    marketingConsentRejectedLabel: 'respins',
    marketingAcceptLabel: 'Acceptă marketing',
    marketingRejectLabel: 'Respinge marketing',
    footerDescription: 'Povești ilustrate create cu AI pentru familii. Informațiile legale sunt disponibile permanent mai jos.',
    operator: roOperator,
    footerGroups: [
      {
        title: 'Legal',
        links: [legalLinks.terms, legalLinks.privacy, legalLinks.cookies],
      },
      {
        title: 'Consumatori',
        links: [legalLinks.withdrawalRefunds, legalLinks.consumerProtection, legalLinks.sal],
      },
      {
        title: 'Contact',
        links: [legalLinks.contact, legalLinks.anpc],
      },
      {
        title: 'Articole',
        links: [legalLinks.readingTogether, legalLinks.storiesVsVideos],
      },
    ],
    documents: roDocuments,
  },
  en: {
    key: 'en',
    domains: [],
    localeLabel: 'English',
    updatedLabel: 'Updated',
    legalNavLabel: 'Legal',
    marketingConsentLabel: 'Marketing consent',
    marketingConsentAcceptedLabel: 'accepted',
    marketingConsentRejectedLabel: 'rejected',
    marketingAcceptLabel: 'Accept marketing',
    marketingRejectLabel: 'Reject marketing',
    footerDescription: 'AI-assisted illustrated stories for families. Legal information is always available below.',
    operator: roOperator,
    footerGroups: [
      {
        title: 'Legal',
        links: [enLegalLinks.terms, enLegalLinks.privacy, enLegalLinks.cookies],
      },
      {
        title: 'Consumers',
        links: [enLegalLinks.withdrawalRefunds, enLegalLinks.consumerProtection, enLegalLinks.contact],
      },
      {
        title: 'Articles',
        links: [enLegalLinks.readingTogether, enLegalLinks.storiesVsVideos],
      },
    ],
    documents: enDocuments,
  },
};

export function getLegalProfileForLanguage(language?: string): LegalProfile {
  return language === 'en' ? legalProfiles.en : legalProfiles.ro;
}

export function getLegalProfileForHostname(hostname?: string): LegalProfile {
  const normalizedHostname = (hostname || '').toLowerCase();
  const matchedProfile = Object.values(legalProfiles).find(profile => (
    profile.domains.some(domain => domain.toLowerCase() === normalizedHostname)
  ));

  return matchedProfile ?? getLegalProfileForLanguage(getConfiguredLegalLanguage());
}

export function getCurrentLegalProfile(): LegalProfile {
  return getLegalProfileForLanguage(getConfiguredLegalLanguage());
}

export function interpolateLegalText(text: string, profile: LegalProfile): string {
  return text.replace(/\{operator\.(\w+)\}/g, (match, key: keyof LegalOperator) => (
    profile.operator[key] ?? match
  ));
}
