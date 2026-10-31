export function getStoryLanguageCopy(language: string) {
  return language === 'ro' ? {
    language: 'Limba poveștii',
    loading: 'Se încarcă limba selectată…',
    fallback: 'Subtitrările nu sunt disponibile în limba selectată. Sunt afișate subtitrările originale.',
    sourceLanguage: 'Limba originală',
    translate: 'Tradu subtitrările',
    translating: 'Se traduc subtitrările…',
    translated: 'Subtitrările au fost traduse.',
    translationFailed: 'Traducerea subtitrărilor a eșuat.',
    translateFirst: 'Tradu subtitrările înainte de a modifica textul acestei pagini.',
    narration: 'Generează narațiunea în această limbă',
    narrationDescription: 'Generează doar narațiunea care lipsește în limba selectată. Subtitrările care lipsesc sunt traduse înainte de generarea audio.',
  } : {
    language: 'Story language',
    loading: 'Loading the selected language…',
    fallback: 'Subtitles are not available in the selected language. The source subtitles are shown.',
    sourceLanguage: 'Source language',
    translate: 'Translate subtitles',
    translating: 'Translating subtitles…',
    translated: 'Subtitles were translated.',
    translationFailed: 'Subtitle translation failed.',
    translateFirst: 'Translate the subtitles before you change the text on this page.',
    narration: 'Generate audio in this language',
    narrationDescription: 'Generate missing audio in the selected language. Missing subtitles are translated before audio generation.',
  };
}
