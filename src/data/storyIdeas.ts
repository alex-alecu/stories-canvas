import type { Language } from '../i18n/types';

/**
 * Hardcoded story ideas per language. Each idea is a short prompt (200-300 chars)
 * based on famous stories culturally relevant to the language.
 * Languages without specific ideas fall back to English.
 */

const storyIdeasByLanguage: Partial<Record<Language, string[]>> = {
  en: [
    'A curious girl falls down a rabbit hole into a magical world where cats grin, caterpillars talk, and a mad queen wants to chop everyone\'s head off. She must find her way home before the dream swallows her whole.',
    'A boy who never grows up whisks three siblings away to a magical island with fairies, mermaids, and pirates. They must outsmart the cunning Captain Hook and decide if they ever want to return home.',
    'A farm girl and her little dog are swept by a tornado to a colorful land. With a scarecrow, a tin man, and a cowardly lion, she follows a yellow brick road to find the great wizard who can send her home.',
    'A wooden puppet dreams of becoming a real boy. With a talking cricket as his conscience, he faces temptation and danger, learning that courage, truthfulness, and kindness are what make someone truly alive.',
    'A little prince from a tiny asteroid visits Earth and meets a pilot stranded in the desert. Together they share stories about a rose, a fox, and what it means to see with the heart instead of the eyes.',
    'Three little pigs set out to build their own houses. One builds with straw, another with sticks, and the third with bricks. A big bad wolf comes huffing and puffing, but only the strongest house stands tall.',
    'A girl locked in a tower by a wicked witch lets down her impossibly long golden hair. A brave prince climbs up, and together they plan a daring escape from the tower and the witch\'s dark magic.',
    'A young orphan discovers he is a wizard and enters a magical school hidden from the ordinary world. He makes loyal friends, learns amazing spells, and faces a dark sorcerer who threatens everything he loves.',
    'A tiny mermaid trades her voice for human legs to win the love of a prince she rescued from a shipwreck. She must earn his kiss before sunset or be lost to the sea foam forever.',
    'A kind girl mistreated by her stepsisters gets help from a fairy godmother who transforms a pumpkin into a coach. She dances with the prince at the ball but must leave before the magic fades at midnight.',
  ],

  ro: [
    'Un fecior de imparat pleaca in lume sa gaseasca Tinerete fara Batranete si Viata fara de Moarte. Calatoreste prin taramuri fermecate, invinge zmei si descopera ca timpul este cel mai de pret dar al vietii.',
    'Harap-Alb, fiul unui imparat, porneste intr-o calatorie plina de incercari. Ajutat de Sfanta Duminica si de prieteni magici, trebuie sa invinga pe Span si sa dovedeasca ca este demn de tronul tatalui sau.',
    'Greuceanu, un viteaz nascut din puteri magice, se lupta cu zmeii care au furat soarele si luna de pe cer. Cu curaj si iscusinta, el aduce lumina inapoi in lume si salveaza pe toti din intuneric.',
    'Fat-Frumos pleaca sa o salveze pe Ileana Cosanzeana, rapita de un zmeu cu sapte capete. Calare pe un cal nazdravanul, traverseaza paduri fermecate si infrange raul cu puterea dragostei si a curajului.',
    'Praslea cel Voinic si Merele de Aur porneste sa afle cine fura merele fermecate din gradina tatalui sau. Coboara in adancul pamantului si descopera un taram ascuns unde trebuie sa invinga trei zmei.',
    'O capra cu trei iezi ii invata pe micuti sa nu deschida usa strainilor. Lupul cel viclean reuseste sa ii pacaleasca, dar mama capra face totul pentru a-si salva copiii dintr-o situatie periculoasa.',
    'Pacala, cel mai destept si mai poznas taran din sat, isi pacaleste vecinii cu glume si smecherii. Dar lectiile lui sunt mereu despre dreptate, generozitate si cum sa razi de prostia celor lacomi.',
    'Un pescar sarac gaseste un peste de aur care ii indeplineste orice dorinta. Dar nevasta lui lacomie cere din ce in ce mai mult, pana cand totul se intoarce de unde a plecat.',
    'Doi copii se ratacesc in Padurea Fermecata si gasesc o casuta facuta din turta dulce. Vrajitoarea care locuieste acolo ii ademaneste, dar cu istemine si curaj, copiii reusesc sa scape si sa se intoarca acasa.',
    'Un cioban intelept rezolva ghicitorile unui imparat si castiga jumatate din imparatie. Povestea arata ca mintea ascutita si bunatatea sufletului sunt mai valoroase decat orice comoara de aur sau pietre pretioase.',
  ],

  fr: [
    'Un petit prince quitte sa minuscule planete et sa rose capricieuse pour explorer l\'univers. Sur Terre, il rencontre un aviateur et un renard qui lui apprend que l\'essentiel est invisible pour les yeux.',
    'Un chat malin chausse des bottes et, par la ruse, transforme son maitre pauvre en marquis. Il affronte un ogre terrible et prouve que l\'intelligence et l\'audace valent plus que la naissance et la richesse.',
    'Une jeune fille courageuse accepte de vivre dans le chateau d\'une bete terrifiante pour sauver son pere. Peu a peu, elle decouvre la bonte cachee sous l\'apparence monstrueuse et brise la malediction par l\'amour.',
    'Une petite fille au chaperon rouge traverse la foret pour rendre visite a sa grand-mere. En chemin, un loup ruse tente de la devorer, mais un chasseur courageux arrive juste a temps pour la sauver.',
    'Un petit garcon minuscule, pas plus grand qu\'un pouce, part a l\'aventure dans un monde geant. Il affronte des dangers enormes avec courage et astuce, prouvant que la taille ne fait pas la valeur.',
    'Cendrillon, maltraitee par sa maratre, recoit l\'aide d\'une fee qui la transforme pour le bal du prince. A minuit, la magie disparait, mais une pantoufle de verre guide le prince vers son veritable amour.',
    'Un homme a la barbe bleue cache un terrible secret dans une chambre interdite de son chateau. Sa nouvelle epouse, poussee par la curiosite, decouvre l\'horreur et doit trouver un moyen de s\'echapper.',
    'Un jeune garcon vole les bottes de sept lieues d\'un ogre endormi et devient le messager le plus rapide du royaume. Grace a son courage, il sauve sa famille de la pauvrete et gagne la faveur du roi.',
    'Une fee offre un don merveilleux a une princesse: chaque mot qu\'elle prononce se transforme en fleur ou en pierre precieuse. Sa soeur jalouse recoit le don inverse et doit apprendre l\'humilite.',
    'Un gentil bucheron et sa femme, trop pauvres pour nourrir leurs enfants, les abandonnent dans la foret. Le petit Poucet, le plus malin, seme des cailloux et guide ses freres vers la maison et la securite.',
  ],

  de: [
    'Zwei Kinder verirren sich im Wald und finden ein Haus aus Lebkuchen und Sussigkeiten. Eine bose Hexe lockt sie hinein, aber mit Mut und Klugheit uberlisten die Geschwister die Hexe und finden den Weg nach Hause.',
    'Ein kleines Madchen bekommt einen Nussknacker zu Weihnachten. In der Nacht erwacht er zum Leben und fuhrt sie in ein magisches Reich voller tanzender Schneeflocken und Zuckerfeen im Kampf gegen den Mausekonig.',
    'Ein kleines Mannchen hilft einer jungen Frau, Stroh zu Gold zu spinnen. Als Preis verlangt es ihr erstgeborenes Kind. Nur wenn sie seinen Namen erraten kann, darf sie ihr Kind behalten.',
    'Zwolf Bruder werden in Schwane verwandelt und ihre kleine Schwester muss sechs Jahre schweigen und Hemden aus Brennnesseln nahen, um den Fluch zu brechen und ihre Bruder zu retten.',
    'Ein tapferer Junge zieht in die Welt, um das Furchten zu lernen. Er ubernachtet in einem verwunschenen Schloss voller Geister und besteht drei gruselige Nachte, bis er endlich das Gruseln lernt.',
    'Ein Fischer fangt einen sprechenden Fisch, der ihm Wunsche erfullt. Seine gierige Frau verlangt immer mehr, bis sie Kaiserin und sogar Papst werden will, und am Ende alles verloren geht.',
    'Ein kleines Madchen mit roten Schuhen kann nicht aufhoren zu tanzen. Sie tanzt durch Dorfer und Walder, bis ein freundlicher Engel ihr hilft, den Fluch zu brechen und Demut zu lernen.',
    'Die Bremer Stadtmusikanten, ein Esel, ein Hund, eine Katze und ein Hahn, ziehen gemeinsam los. Sie vertreiben Rauber aus einem Waldhaus und finden dort ein neues Zuhause voller Freundschaft und Musik.',
    'Ein Konig verspricht seiner sterbenden Frau, nur eine Frau zu heiraten, die ebenso schon ist. Als er seine eigene Tochter wahlt, flieht sie verkleidet in einem Mantel aus tausend Pelzen in die weite Welt.',
    'Ein mutiger Schneider erschlagt sieben Fliegen auf einen Streich und zieht prahlend in die Welt. Durch List und Cleverness besiegt er Riesen und gewinnt am Ende ein halbes Konigreich und die Prinzessin.',
  ],

  it: [
    'Un burattino di legno prende vita e sogna di diventare un bambino vero. Con il suo grillo parlante, affronta tentazioni e pericoli, imparando che il coraggio e la bonta rendono vivi davvero.',
    'Un ragazzo povero scopre una lampada magica con un genio potentissimo. Con tre desideri, deve sconfiggere un malvagio stregone e conquistare il cuore della principessa, imparando il vero valore dell\'onesta.',
    'Una bambina piccola come un pollice nasce da un fiore magico e vive avventure incredibili. Attraversa stagni su foglie di ninfea e vola con le rondini, cercando un posto dove essere finalmente felice.',
    'Un vecchio falegname scolpisce un burattino che parla e cammina. Il burattino fugge, incontra un gatto e una volpe truffaldini, e impara a proprie spese che le scorciatoie non portano mai alla felicita.',
    'Arlecchino, un servo furbo e colorato, si mette nei guai con il suo padrone avaro. Con battute argute e travestimenti, risolve ogni problema e fa ridere tutti, dimostrando che l\'astuzia batte la ricchezza.',
    'Un giovane marinaio veneziano salpa verso terre sconosciute e scopre un palazzo di ghiaccio abitato da un re gentile. Impara che i veri tesori non sono oro e gioielli, ma le storie da raccontare.',
    'Tre fratelli partono alla ricerca di una fonte magica che guarisce ogni male. Solo il piu giovane e umile riesce a trovarla, perche ascolta i consigli degli animali della foresta lungo la strada.',
    'Una principessa coraggiosa sfida un drago che terrorizza il suo villaggio in Sicilia. Senza armatura ne spada, usa l\'intelligenza e la gentilezza per trasformare il drago in un protettore del regno.',
    'Un pescatore sardo trova una conchiglia che canta melodie incantate. La musica attira creature marine magiche che lo guidano verso un\'isola nascosta dove i sogni dei bambini prendono forma e colore.',
    'Una nonna napoletana racconta ai nipoti la storia di un re trasformato in gatto. Solo l\'amore di una bambina gentile puo spezzare l\'incantesimo e riportare la pace nel piccolo regno sul golfo.',
  ],

  hu: [
    'Ludas Matyi, egy ravasz parasztfiu, haromszor veri el a gonog foldesurat, aki igazsagtalanul bant vele. Eszevel es batorasagaval bizonyitja, hogy a szegeny ember is legyozheti az igazsagtalansagot.',
    'A Pal utcai fiuk csapata megvedi szeretett grundjukat a Voros Ingekkel szemben. Nemecsek, a legkisebb fiu, hosies batorsaggal kuld a csapataert, megmutatva, hogy a valosdi hosiesseget nem a meret hatarozza meg.',
    'Janos vitez, egy arva parasztlegeny, elindul, hogy megtalja szerelmet, Iluskajat. Orias tunden, botorikon es tongerenken at utazik, hogy eljusson Tunderorszagba, ahol az orok szerelem var ra.',
    'Matyas kiraly alruhaban jarja az orszagot es meglatogatja az egyszeru embereket. Igazsagot szolgaltat a szegenyeknek es leckeket ad az onzo gazdagoknak, megmutatva, hogy a jo kiraly a nepet szolgalja.',
    'Egy kis kacsa, akit mindenki csufnak tart, szomoruan vandorol a tavon. Amikor eljion a tavasz, gyonyoru hattyuva valik, es mindenki racsodalkozik, bizonyitva, hogy a szepseg belurol fakad.',
    'Egy szegeny fiu egy aranyszoru baranyra bukkan az erdoben. A barany varazslatos gyapja gazdagga teszi, de meg kell tanulnia, hogy a valosdi kincs a josag es a baratsag, nem az arany.',
    'Egy bator kislany behatol a sarkany barlangjaba, hogy visszaszerezze a faluja ellopott napfenyet. Nem karddal, hanem egy dallal es egy mosolyukkal gyozi le a szornyet es hozza vissza a fenyt.',
    'Het kisgerda varazslatos feladatokat kap egy bolcs tundertol. Mindegyik kihivas mas-mas erenyt tanit meg nekik: batorsagot, kedvesseget es csapatmunkat, mire elnyerik a varazslatos konyvet.',
    'Egy oreg halasz kifog egy aranyhalat, amely harom kivanasagot teljesit. Felesege egyre tobbet kovetel, amig minden varazslat szertefoszlik, megtanitva oket, hogy a megelegedes a legfobb boldogsag.',
    'Egy kicsi tucsok egyedul indul el a nagyvilagba, hogy megtalja a helyet, ahova tartozik. Utja soran baratsagot kot egy bogarral, egy csinaval, es megtanulja, hogy az otthon az, ahol szeretnek.',
  ],

  zh: [
    'Yi zhi xiao houzi cong shitouli bengchulai, xuexi le qishier ban bianhua he jingdou yun. Ta gen yige seng ren qu xitian qu jing, luxhang yudao yaogui he monan, zuizhong chengwei le zhenzheng de yingxiong.',
    'Yi ge yonggan de nühai Mulan nüban nanzhuang, daitie fuqin shang zhanchang. Ta yingde le zhanzheng he tongban de zunzhong, zhengming le yongqi he zhongcheng bu fen xingbie.',
    'Yi ge xiao nanhai Nezha cong huo yan jingjing li chusheng, yongyou qiangda de shenli. Ta fan kang longwang baohu jiaren he cunmin, xuehuile zeren he xisheng de yiyi.',
    'Chang\'e chi le xiangyao fei shang yueqiu, yongyuan he zhangfu fenli. Meinian zhongqiu jie, renmen wangzhe yueliang, xiangqi ta de gushi, ganshou ai he xisheng de meixue.',
    'Yi ge fangniu wa yongyou yizhi shenniu, ta bang ta bian chu yifu he shiwu. Meinian qixi jie, xiqueniao jiecheng qiao, rang fangniu he zhinü zai yinheshang xiangju.',
    'Yi ge xiao nanhai yongyou yizhi shenbi, hua de dongxi dou hui biancheng zhenshi de. Ta yong shenbi bang qiongren, dui fu tanlan de guanyuan, zhengming le shangliang he zhihui de liliang.',
    'Sange xiongdi qu xunzhao changsheng bu lao de mishu. Zhiyou zuixiao zuishan de didi chenggong le, yinwei ta bangzhu le lu shang yudao de mei yige xu yao bangzhu de ren.',
    'Yi zhi xiao liyu yongli tiaoguole longmen, biancheng le yitiao jinlong. Zhe ge gushi jiaoyu haizimen, zhiyao nuli he jiancheng, jiu neng shixian zuida de mengxiang.',
    'Yi ge congming de xiao guniang yong zhihui he shangliang zhifu le yaoguai, jiuzhu le beikunzhu de cunmin. Ta de gushi gaosu women, zhihui bi liliang geng qiangda.',
    'Hou Yi shexia le jiuge taiyang, zhengjiule renmen. Dan ta de qi zi Chang\'e wule xiangyao fei shang le tian. Zhe ge gushi jiangshule yongqi, ai he yongheng de xisheng.',
  ],
};

/**
 * Returns a random story idea for the given language.
 * Falls back to English for languages without specific ideas.
 */
export function getRandomStoryIdea(language: Language): string {
  const ideas = storyIdeasByLanguage[language] ?? storyIdeasByLanguage.en!;
  return ideas[Math.floor(Math.random() * ideas.length)];
}
