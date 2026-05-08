import type { Language } from '../i18n/types';

interface StoryIdea {
  title: string;
  description: string;
}

/**
 * Hardcoded story ideas per language. Each idea becomes a short prompt (200-300 chars)
 * based on famous stories culturally relevant to the language.
 * Languages without specific ideas fall back to English.
 */

const storyIdeasByLanguage: Partial<Record<Language, StoryIdea[]>> = {
  en: [
    {
      title: 'Alice in Wonderland',
      description: 'A curious girl falls down a rabbit hole into a magical world where cats grin, caterpillars talk, and a mad queen wants to chop everyone\'s head off. She must find her way home before the dream swallows her whole.',
    },
    {
      title: 'Peter Pan',
      description: 'A boy who never grows up whisks three siblings away to a magical island with fairies, mermaids, and pirates. They must outsmart the cunning Captain Hook and decide if they ever want to return home.',
    },
    {
      title: 'The Wonderful Wizard of Oz',
      description: 'A farm girl and her little dog are swept by a tornado to a colorful land. With a scarecrow, a tin man, and a cowardly lion, she follows a yellow brick road to find the great wizard who can send her home.',
    },
    {
      title: 'Pinocchio',
      description: 'A wooden puppet dreams of becoming a real boy. With a talking cricket as his conscience, he faces temptation and danger, learning that courage, truthfulness, and kindness are what make someone truly alive.',
    },
    {
      title: 'The Little Prince',
      description: 'A little prince from a tiny asteroid visits Earth and meets a pilot stranded in the desert. Together they share stories about a rose, a fox, and what it means to see with the heart instead of the eyes.',
    },
    {
      title: 'The Three Little Pigs',
      description: 'Three little pigs set out to build their own houses. One builds with straw, another with sticks, and the third with bricks. A big bad wolf comes huffing and puffing, but only the strongest house stands tall.',
    },
    {
      title: 'Rapunzel',
      description: 'A girl locked in a tower by a wicked witch lets down her impossibly long golden hair. A brave prince climbs up, and together they plan a daring escape from the tower and the witch\'s dark magic.',
    },
    {
      title: 'Harry Potter',
      description: 'A young orphan discovers he is a wizard and enters a magical school hidden from the ordinary world. He makes loyal friends, learns amazing spells, and faces a dark sorcerer who threatens everything he loves.',
    },
    {
      title: 'The Little Mermaid',
      description: 'A tiny mermaid trades her voice for human legs to win the love of a prince she rescued from a shipwreck. She must earn his kiss before sunset or be lost to the sea foam forever.',
    },
    {
      title: 'Cinderella',
      description: 'A kind girl mistreated by her stepsisters gets help from a fairy godmother who transforms a pumpkin into a coach. She dances with the prince at the ball but must leave before the magic fades at midnight.',
    },
  ],

  ro: [
    {
      title: 'Tinerețe fără Bătrânețe și Viață fără de Moarte',
      description: 'Adaptează fidel basmul din domeniul public al lui Petre Ispirescu, păstrând dorința prințului, tărâmurile fermecate, interdicția încălcată și dorul de casă.',
    },
    {
      title: 'Harap-Alb',
      description: 'Adaptează fidel basmul din domeniul public al lui Ion Creangă: drumul fiului de crai, Spânul, Sfânta Duminică, ajutoarele năzdrăvane, probele și recunoașterea finală.',
    },
    {
      title: 'Greuceanu',
      description: 'Adaptează fidel basmul din domeniul public al lui Petre Ispirescu: Împăratul Roșu, Faurul Pământului, zmeii care au furat soarele și luna, capcanele zmeoaicelor și întoarcerea luminii în lume.',
    },
    {
      title: 'Făt-Frumos și Ileana Cosânzeana',
      description: 'Făt-Frumos pleacă să o salveze pe Ileana Cosânzeana, răpită de un zmeu cu șapte capete. Călare pe un cal năzdrăvan, traversează păduri fermecate și înfrânge răul cu puterea dragostei și a curajului.',
    },
    {
      title: 'Prâslea cel voinic și merele de aur',
      description: 'Adaptează fidel basmul din domeniul public al lui Petre Ispirescu: paza merelor, coborârea pe tărâmul celălalt, zmeii, fetele de împărat și întoarcerea cu dovada.',
    },
    {
      title: 'Capra cu trei iezi',
      description: 'O capră cu trei iezi îi învață pe micuți să nu deschidă ușa străinilor. Lupul cel viclean reușește să îi păcălească, dar mama capră face totul pentru a-și salva copiii dintr-o situație periculoasă.',
    },
    {
      title: 'Păcală',
      description: 'Păcală, cel mai deștept și mai poznaș țăran din sat, își păcălește vecinii cu glume și șmecherii. Dar lecțiile lui sunt mereu despre dreptate, generozitate și cum să râzi de prostia celor lacomi.',
    },
    {
      title: 'Pescarul și peștele de aur',
      description: 'Un pescar sărac găsește un pește de aur care îi îndeplinește orice dorință. Dar nevasta lui lacomă cere din ce în ce mai mult, până când totul se întoarce de unde a plecat.',
    },
    {
      title: 'Hansel și Gretel',
      description: 'Doi copii se rătăcesc în Pădurea Fermecată și găsesc o căsuță făcută din turtă dulce. Vrăjitoarea care locuiește acolo îi ademănește, dar cu istețime și curaj, copiii reușesc să scape și să se întoarcă acasă.',
    },
    {
      title: 'Ciobanul cel isteț',
      description: 'Un cioban înțelept rezolvă ghicitorile unui împărat și câștigă jumătate din împărăție. Povestea arată că mintea ascuțită și bunătatea sufletului sunt mai valoroase decât orice comoară de aur sau pietre prețioase.',
    },
    {
      title: 'Fata babei și fata moșneagului',
      description: 'Adaptează fidel basmul din domeniul public al lui Ion Creangă: fata harnică ajută cuptorul, fântâna, părul și cățelușa, este răsplătită, iar fata leneșă primește urmările purtării ei.',
    },
    {
      title: 'Ursul păcălit de vulpe',
      description: 'Adaptează fidel povestea din domeniul public a lui Ion Creangă: vulpea se preface moartă, fură peștele, îl păcălește pe urs să pescuiască cu coada și scapă prin istețime.',
    },
    {
      title: 'Dănilă Prepeleac',
      description: 'Adaptează fidel povestea din domeniul public a lui Ion Creangă: schimburile păguboase ale lui Dănilă, hotărârea de a se călugări, întâlnirea cu dracii și probele câștigate prin viclenie.',
    },
    {
      title: 'Ivan Turbincă',
      description: 'Adaptează fidel povestea din domeniul public a lui Ion Creangă: soldatul Ivan primește turbinca năzdrăvană, îi păcălește pe diavoli, o prinde pe Moarte și învață cât de prețioasă este viața.',
    },
    {
      title: 'Punguța cu doi bani',
      description: 'Adaptează fidel povestea din domeniul public a lui Ion Creangă: cocoșul alungat găsește punguța, boierul încearcă să i-o ia, iar cocoșul trece prin apă, foc și cirezi până își recuperează norocul.',
    },
    {
      title: 'Sarea în bucate',
      description: 'Adaptează fidel basmul din domeniul public al lui Petre Ispirescu: fata cea mică își iubește tatăl ca sarea în bucate, este izgonită, apoi dovedește la ospăț cât valorează iubirea ei.',
    },
    {
      title: 'Aleodor Împărat',
      description: 'Adaptează fidel basmul din domeniul public al lui Petre Ispirescu: Aleodor încalcă hotarul interzis, primește probe grele și izbutește cu ajutorul peștelui, corbului și tăunului recunoscător.',
    },
    {
      title: 'Zâna Zorilor',
      description: 'Adaptează fidel basmul din domeniul public al lui Ioan Slavici: împăratul bolnav, călătoria lui Petru, ajutoarele primite, probele pentru apa vie și întâlnirea cu Zâna Zorilor.',
    },
    {
      title: 'Făt-Frumos din lacrimă',
      description: 'Adaptează fidel basmul din domeniul public al lui Mihai Eminescu: nașterea miraculoasă, prietenia cu fiul de împărat, Muma Pădurii, Genarul și încercările pentru Ileana.',
    },
    {
      title: 'Povestea porcului',
      description: 'Adaptează fidel basmul din domeniul public al lui Ion Creangă: bătrânii primesc un purcel fermecat, prințesa arde pielea porcului, apoi pleacă la drum lung să-și regăsească soțul vrăjit.',
    },
  ],

  fr: [
    {
      title: 'Le Petit Prince',
      description: 'Un petit prince quitte sa minuscule planète et sa rose capricieuse pour explorer l\'univers. Sur Terre, il rencontre un aviateur et un renard qui lui apprend que l\'essentiel est invisible pour les yeux.',
    },
    {
      title: 'Le Chat botté',
      description: 'Un chat malin chausse des bottes et, par la ruse, transforme son maître pauvre en marquis. Il affronte un ogre terrible et prouve que l\'intelligence et l\'audace valent plus que la naissance et la richesse.',
    },
    {
      title: 'La Belle et la Bête',
      description: 'Une jeune fille courageuse accepte de vivre dans le château d\'une bête terrifiante pour sauver son père. Peu à peu, elle découvre la bonté cachée sous l\'apparence monstrueuse et brise la malédiction par l\'amour.',
    },
    {
      title: 'Le Petit Chaperon rouge',
      description: 'Une petite fille au chaperon rouge traverse la forêt pour rendre visite à sa grand-mère. En chemin, un loup rusé tente de la dévorer, mais un chasseur courageux arrive juste à temps pour la sauver.',
    },
    {
      title: 'Tom Pouce',
      description: 'Un petit garçon minuscule, pas plus grand qu\'un pouce, part à l\'aventure dans un monde géant. Il affronte des dangers énormes avec courage et astuce, prouvant que la taille ne fait pas la valeur.',
    },
    {
      title: 'Cendrillon',
      description: 'Cendrillon, maltraitée par sa marâtre, reçoit l\'aide d\'une fée qui la transforme pour le bal du prince. À minuit, la magie disparaît, mais une pantoufle de verre guide le prince vers son véritable amour.',
    },
    {
      title: 'Barbe Bleue',
      description: 'Un homme à la barbe bleue cache un terrible secret dans une chambre interdite de son château. Sa nouvelle épouse, poussée par la curiosité, découvre l\'horreur et doit trouver un moyen de s\'échapper.',
    },
    {
      title: 'Les Bottes de sept lieues',
      description: 'Un jeune garçon vole les bottes de sept lieues d\'un ogre endormi et devient le messager le plus rapide du royaume. Grâce à son courage, il sauve sa famille de la pauvreté et gagne la faveur du roi.',
    },
    {
      title: 'Les Fées',
      description: 'Une fée offre un don merveilleux à une princesse: chaque mot qu\'elle prononce se transforme en fleur ou en pierre précieuse. Sa sœur jalouse reçoit le don inverse et doit apprendre l\'humilité.',
    },
    {
      title: 'Le Petit Poucet',
      description: 'Un gentil bûcheron et sa femme, trop pauvres pour nourrir leurs enfants, les abandonnent dans la forêt. Le petit Poucet, le plus malin, sème des cailloux et guide ses frères vers la maison et la sécurité.',
    },
  ],

  de: [
    {
      title: 'Hänsel und Gretel',
      description: 'Zwei Kinder verirren sich im Wald und finden ein Haus aus Lebkuchen und Süßigkeiten. Eine böse Hexe lockt sie hinein, aber mit Mut und Klugheit überlisten die Geschwister die Hexe und finden den Weg nach Hause.',
    },
    {
      title: 'Der Nussknacker und der Mausekönig',
      description: 'Ein kleines Mädchen bekommt einen Nussknacker zu Weihnachten. In der Nacht erwacht er zum Leben und führt sie in ein magisches Reich voller tanzender Schneeflocken und Zuckerfeen im Kampf gegen den Mäusekönig.',
    },
    {
      title: 'Rumpelstilzchen',
      description: 'Ein kleines Männchen hilft einer jungen Frau, Stroh zu Gold zu spinnen. Als Preis verlangt es ihr erstgeborenes Kind. Nur wenn sie seinen Namen erraten kann, darf sie ihr Kind behalten.',
    },
    {
      title: 'Die zwölf Brüder',
      description: 'Zwölf Brüder werden in Schwäne verwandelt und ihre kleine Schwester muss sechs Jahre schweigen und Hemden aus Brennnesseln nähen, um den Fluch zu brechen und ihre Brüder zu retten.',
    },
    {
      title: 'Märchen von einem, der auszog das Fürchten zu lernen',
      description: 'Ein tapferer Junge zieht in die Welt, um das Fürchten zu lernen. Er übernachtet in einem verwunschenen Schloss voller Geister und besteht drei gruselige Nächte, bis er endlich das Gruseln lernt.',
    },
    {
      title: 'Vom Fischer und seiner Frau',
      description: 'Ein Fischer fängt einen sprechenden Fisch, der ihm Wünsche erfüllt. Seine gierige Frau verlangt immer mehr, bis sie Kaiserin und sogar Papst werden will, und am Ende alles verloren geht.',
    },
    {
      title: 'Die roten Schuhe',
      description: 'Ein kleines Mädchen mit roten Schuhen kann nicht aufhören zu tanzen. Sie tanzt durch Dörfer und Wälder, bis ein freundlicher Engel ihr hilft, den Fluch zu brechen und Demut zu lernen.',
    },
    {
      title: 'Die Bremer Stadtmusikanten',
      description: 'Die Bremer Stadtmusikanten, ein Esel, ein Hund, eine Katze und ein Hahn, ziehen gemeinsam los. Sie vertreiben Räuber aus einem Waldhaus und finden dort ein neues Zuhause voller Freundschaft und Musik.',
    },
    {
      title: 'Allerleirauh',
      description: 'Ein König verspricht seiner sterbenden Frau, nur eine Frau zu heiraten, die ebenso schön ist. Als er seine eigene Tochter wählt, flieht sie verkleidet in einem Mantel aus tausend Pelzen in die weite Welt.',
    },
    {
      title: 'Das tapfere Schneiderlein',
      description: 'Ein mutiger Schneider erschlägt sieben Fliegen auf einen Streich und zieht prahlend in die Welt. Durch List und Cleverness besiegt er Riesen und gewinnt am Ende ein halbes Königreich und die Prinzessin.',
    },
  ],

  it: [
    {
      title: 'Pinocchio',
      description: 'Un burattino di legno prende vita e sogna di diventare un bambino vero. Con il suo grillo parlante, affronta tentazioni e pericoli, imparando che il coraggio e la bontà rendono vivi davvero.',
    },
    {
      title: 'Aladino e la lampada magica',
      description: 'Un ragazzo povero scopre una lampada magica con un genio potentissimo. Con tre desideri, deve sconfiggere un malvagio stregone e conquistare il cuore della principessa, imparando il vero valore dell\'onestà.',
    },
    {
      title: 'Pollicina',
      description: 'Una bambina piccola come un pollice nasce da un fiore magico e vive avventure incredibili. Attraversa stagni su foglie di ninfea e vola con le rondini, cercando un posto dove essere finalmente felice.',
    },
    {
      title: 'Le avventure di Pinocchio',
      description: 'Un vecchio falegname scolpisce un burattino che parla e cammina. Il burattino fugge, incontra un gatto e una volpe truffaldini, e impara a proprie spese che le scorciatoie non portano mai alla felicità.',
    },
    {
      title: 'Arlecchino',
      description: 'Arlecchino, un servo furbo e colorato, si mette nei guai con il suo padrone avaro. Con battute argute e travestimenti, risolve ogni problema e fa ridere tutti, dimostrando che l\'astuzia batte la ricchezza.',
    },
    {
      title: 'Il marinaio veneziano e il palazzo di ghiaccio',
      description: 'Un giovane marinaio veneziano salpa verso terre sconosciute e scopre un palazzo di ghiaccio abitato da un re gentile. Impara che i veri tesori non sono oro e gioielli, ma le storie da raccontare.',
    },
    {
      title: 'La fonte magica',
      description: 'Tre fratelli partono alla ricerca di una fonte magica che guarisce ogni male. Solo il più giovane e umile riesce a trovarla, perché ascolta i consigli degli animali della foresta lungo la strada.',
    },
    {
      title: 'La principessa e il drago di Sicilia',
      description: 'Una principessa coraggiosa sfida un drago che terrorizza il suo villaggio in Sicilia. Senza armatura né spada, usa l\'intelligenza e la gentilezza per trasformare il drago in un protettore del regno.',
    },
    {
      title: 'La conchiglia che canta',
      description: 'Un pescatore sardo trova una conchiglia che canta melodie incantate. La musica attira creature marine magiche che lo guidano verso un\'isola nascosta dove i sogni dei bambini prendono forma e colore.',
    },
    {
      title: 'Il re trasformato in gatto',
      description: 'Una nonna napoletana racconta ai nipoti la storia di un re trasformato in gatto. Solo l\'amore di una bambina gentile può spezzare l\'incantesimo e riportare la pace nel piccolo regno sul golfo.',
    },
  ],

  hu: [
    {
      title: 'Lúdas Matyi',
      description: 'Lúdas Matyi, egy ravasz parasztfiú, háromszor veri el a gonosz földesurat, aki igazságtalanul bánt vele. Eszével és bátorságával bizonyítja, hogy a szegény ember is legyőzheti az igazságtalanságot.',
    },
    {
      title: 'A Pál utcai fiúk',
      description: 'A Pál utcai fiúk csapata megvédi szeretett grundjukat a Vörös Ingekkel szemben. Nemecsek, a legkisebb fiú, hősies bátorsággal küzd a csapatáért, megmutatva, hogy a valódi hősiességet nem a méret határozza meg.',
    },
    {
      title: 'János vitéz',
      description: 'János vitéz, egy árva parasztlegény, elindul, hogy megtalálja szerelmét, Iluskáját. Óriásokon, boszorkányokon és tengereken át utazik, hogy eljusson Tündérországba, ahol az örök szerelem vár rá.',
    },
    {
      title: 'Mátyás király álruhában',
      description: 'Mátyás király álruhában járja az országot és meglátogatja az egyszerű embereket. Igazságot szolgáltat a szegényeknek és leckéket ad az önző gazdagoknak, megmutatva, hogy a jó király a népét szolgálja.',
    },
    {
      title: 'A rút kiskacsa',
      description: 'Egy kis kacsa, akit mindenki csúfnak tart, szomorúan vándorol a tavon. Amikor eljön a tavasz, gyönyörű hattyúvá válik, és mindenki rácsodálkozik, bizonyítva, hogy a szépség belülről fakad.',
    },
    {
      title: 'Az aranyszőrű bárány',
      description: 'Egy szegény fiú egy aranyszőrű bárányra bukkan az erdőben. A bárány varázslatos gyapja gazdaggá teszi, de meg kell tanulnia, hogy a valódi kincs a jóság és a barátság, nem az arany.',
    },
    {
      title: 'A kislány és a sárkány barlangja',
      description: 'Egy bátor kislány behatol a sárkány barlangjába, hogy visszaszerezze a faluja ellopott napfényét. Nem karddal, hanem egy dallal és egy mosollyal győzi le a szörnyet és hozza vissza a fényt.',
    },
    {
      title: 'A hét gyerek és a bölcs tündér',
      description: 'Hét kisgyerek varázslatos feladatokat kap egy bölcs tündértől. Mindegyik kihívás más-más erényt tanít meg nekik: bátorságot, kedvességet és csapatmunkát, mire elnyerik a varázslatos könyvet.',
    },
    {
      title: 'A halász és az aranyhal',
      description: 'Egy öreg halász kifog egy aranyhalat, amely három kívánságot teljesít. Felesége egyre többet követel, amíg minden varázslat szertefoszlik, megtanítva őket, hogy a megelégedés a legfőbb boldogság.',
    },
    {
      title: 'A kicsi tücsök útja',
      description: 'Egy kicsi tücsök egyedül indul el a nagyvilágba, hogy megtalálja a helyét, ahová tartozik. Útja során barátságot köt egy bogárral, egy csigával, és megtanulja, hogy az otthon az, ahol szeretnek.',
    },
  ],

  zh: [
    {
      title: '西游记',
      description: '一只小猴子从石头里蹦出来，学会了七十二般变化和筋斗云。他跟一个僧人去西天取经，路上遇到妖怪和磨难，最终成为了真正的英雄。',
    },
    {
      title: '花木兰',
      description: '一个勇敢的女孩花木兰女扮男装，替父亲上战场。她赢得了战争和同伴们的尊重，证明了勇气和忠诚不分性别。',
    },
    {
      title: '哪吒闹海',
      description: '一个小男孩哪吒从火焰中诞生，拥有强大的神力。他反抗龙王保护家人和村民，学会了责任和牺牲的意义。',
    },
    {
      title: '嫦娥奔月',
      description: '嫦娥吃了仙药飞上月球，永远和丈夫分离。每年中秋节，人们望着月亮，想起她的故事，感受爱和牺牲的美丽。',
    },
    {
      title: '牛郎织女',
      description: '一个放牛娃拥有一只神牛，它帮他变出衣服和食物。每年七夕节，喜鹊搭成桥，让牛郎和织女在银河上相聚。',
    },
    {
      title: '神笔马良',
      description: '一个小男孩拥有一支神笔，画的东西都会变成真实的。他用神笔帮穷人，对付贪婪的官员，证明了善良和智慧的力量。',
    },
    {
      title: '寻找长生不老术',
      description: '三个兄弟去寻找长生不老的秘术。只有最小最善良的弟弟成功了，因为他帮助了路上遇到的每一个需要帮助的人。',
    },
    {
      title: '鲤鱼跳龙门',
      description: '一只小鲤鱼用力跳过了龙门，变成了一条金龙。这个故事教育孩子们，只要努力和坚持，就能实现最大的梦想。',
    },
    {
      title: '聪明的小姑娘',
      description: '一个聪明的小姑娘用智慧和善良制伏了妖怪，救出了被困住的村民。她的故事告诉我们，智慧比力量更强大。',
    },
    {
      title: '后羿射日',
      description: '后羿射下了九个太阳，拯救了人们。但他的妻子嫦娥误吃了仙药飞上了天。这个故事讲述了勇气、爱和永恒的牺牲。',
    },
  ],
};

const exactOriginalLeadByLanguage: Partial<Record<Language, (title: string) => string>> = {
  en: (title) => `Create the story of ${title}, follow the exact original. `,
  ro: (title) => `Creează povestea ${title}, urmează originalul exact. `,
  fr: (title) => `Crée l'histoire de ${title}, suis exactement l'original. `,
  de: (title) => `Erzähle die Geschichte von ${title}, folge genau dem Original. `,
  it: (title) => `Crea la storia di ${title}, segui esattamente l'originale. `,
  hu: (title) => `Készítsd el ${title} történetét, kövesd pontosan az eredetit. `,
  zh: (title) => `创作《${title}》的故事，严格遵循原作。`,
};

/**
 * Shuffled queues per language. We pop from the queue until empty,
 * then reshuffle and refill — guaranteeing every idea is shown
 * before any repeats.
 */
const queues: Partial<Record<Language, StoryIdea[]>> = {};

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatStoryIdea(language: Language, idea: StoryIdea): string {
  const exactOriginalLead = exactOriginalLeadByLanguage[language] ?? exactOriginalLeadByLanguage.en!;
  return `${exactOriginalLead(idea.title)}${idea.description}`;
}

/**
 * Returns a random story idea for the given language.
 * Falls back to English for languages without specific ideas.
 * Cycles through all ideas in a shuffled order before repeating.
 */
export function getRandomStoryIdea(language: Language): string {
  const ideas = storyIdeasByLanguage[language] ?? storyIdeasByLanguage.en!;
  let queue = queues[language];
  if (!queue || queue.length === 0) {
    queue = shuffled(ideas);
    queues[language] = queue;
  }
  return formatStoryIdea(language, queue.pop()!);
}
