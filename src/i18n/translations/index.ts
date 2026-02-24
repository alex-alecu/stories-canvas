import type { Language, Translations } from '../types';

import ro from './ro';
import en from './en';
import de from './de';
import es from './es';
import fr from './fr';
import it from './it';
import pt from './pt';
import nl from './nl';
import hu from './hu';
import pl from './pl';
import cs from './cs';
import sk from './sk';
import sv from './sv';
import no from './no';
import da from './da';
import fi from './fi';
import ja from './ja';
import zh from './zh';
import ko from './ko';

export const translations: Record<Language, Translations> = {
  ro,
  en,
  de,
  es,
  fr,
  it,
  pt,
  nl,
  hu,
  pl,
  cs,
  sk,
  sv,
  no,
  da,
  fi,
  ja,
  zh,
  ko,
};

export const languageList: { code: Language; name: string }[] = [
  { code: 'ro', name: ro.languageName },
  { code: 'en', name: en.languageName },
  { code: 'de', name: de.languageName },
  { code: 'es', name: es.languageName },
  { code: 'fr', name: fr.languageName },
  { code: 'it', name: it.languageName },
  { code: 'pt', name: pt.languageName },
  { code: 'nl', name: nl.languageName },
  { code: 'hu', name: hu.languageName },
  { code: 'pl', name: pl.languageName },
  { code: 'cs', name: cs.languageName },
  { code: 'sk', name: sk.languageName },
  { code: 'sv', name: sv.languageName },
  { code: 'no', name: no.languageName },
  { code: 'da', name: da.languageName },
  { code: 'fi', name: fi.languageName },
  { code: 'ja', name: ja.languageName },
  { code: 'zh', name: zh.languageName },
  { code: 'ko', name: ko.languageName },
];
