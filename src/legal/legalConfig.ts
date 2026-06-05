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
  website: legalCompany.website,
  jurisdiction: legalCompany.jurisdiction,
};

const legalLinks = {
  terms: { label: 'Termeni și condiții', href: LEGAL_ROUTES.terms },
  privacy: { label: 'Confidențialitate', href: LEGAL_ROUTES.privacy },
  cookies: { label: 'Cookies', href: LEGAL_ROUTES.cookies },
  withdrawalRefunds: { label: 'Retragere și rambursări', href: LEGAL_ROUTES.withdrawalRefunds },
  consumerProtection: { label: 'ANPC / SAL', href: LEGAL_ROUTES.consumerProtection },
  contact: { label: 'Contact', href: LEGAL_ROUTES.contact },
  anpc: { label: 'ANPC', href: 'https://anpc.ro/', external: true },
  sal: { label: 'Reclamații SAL ANPC', href: 'https://reclamatiisal.anpc.ro/', external: true },
} satisfies Record<string, LegalLink>;

function document(
  key: LegalRouteKey,
  title: string,
  description: string,
  sections: LegalSection[],
): LegalDocument {
  return {
    route: LEGAL_ROUTES[key],
    title,
    description,
    updatedAt: '5 iunie 2026',
    updatedAtIso: '2026-06-05',
    sections,
  };
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

export const legalProfiles: Record<LegalProfileKey, LegalProfile> = {
  ro: {
    key: 'ro',
    domains: ['basmul.ro', 'www.basmul.ro', 'povestimagice.ro', 'www.povestimagice.ro', 'localhost', '127.0.0.1'],
    localeLabel: 'Romania',
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
    ],
    documents: roDocuments,
  },
  en: {
    key: 'en',
    domains: [],
    localeLabel: 'English',
    footerDescription: 'AI-assisted illustrated stories for families. English legal copy can be enabled for future domains.',
    operator: roOperator,
    footerGroups: [
      {
        title: 'Legal',
        links: [legalLinks.terms, legalLinks.privacy, legalLinks.cookies],
      },
      {
        title: 'Consumers',
        links: [legalLinks.withdrawalRefunds, legalLinks.consumerProtection, legalLinks.contact],
      },
    ],
    documents: roDocuments,
  },
};

export function getLegalProfileForHostname(hostname?: string): LegalProfile {
  const normalizedHostname = (hostname || '').toLowerCase();
  const matchedProfile = Object.values(legalProfiles).find(profile => (
    profile.domains.some(domain => domain.toLowerCase() === normalizedHostname)
  ));

  return matchedProfile ?? legalProfiles.ro;
}

export function getCurrentLegalProfile(): LegalProfile {
  if (typeof window === 'undefined') {
    return legalProfiles.ro;
  }
  return getLegalProfileForHostname(window.location.hostname);
}

export function interpolateLegalText(text: string, profile: LegalProfile): string {
  return text.replace(/\{operator\.(\w+)\}/g, (match, key: keyof LegalOperator) => (
    profile.operator[key] ?? match
  ));
}
