import { DEFAULT_TEXT_MODEL, TEXT_MODELS, parseTextModelSettings, type TextModelSettings, type ThinkingLevel } from '../../shared/textModels';
import { getWalletCopy } from '../i18n/walletCopy';
import { useLanguage } from '../i18n/LanguageContext';

export default function TextModelPicker({ value, onChange, disabled }: {
  value: TextModelSettings;
  onChange: (value: TextModelSettings) => void;
  disabled: boolean;
}) {
  const { language } = useLanguage();
  const copy = getWalletCopy(language);
  const model = TEXT_MODELS.find(item => item.id === value.textModel)!;
  const selectClass = 'mt-1.5 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100';
  return (
    <div className="rounded-2xl bg-gray-50 p-4 dark:bg-white/5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <label className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
          {copy.model}
          <select aria-label={copy.model} value={value.textModel} disabled={disabled} className={selectClass}
            onChange={event => onChange(parseTextModelSettings(event.target.value, undefined))}>
            {TEXT_MODELS.map(option => <option key={option.id} value={option.id}>
              {option.name}{option.id === DEFAULT_TEXT_MODEL ? ` · ${copy.modelDefault}` : ''}
            </option>)}
          </select>
        </label>
        {model.thinkingLevels.length > 0 && <label className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
          {copy.thinking}
          <select aria-label={copy.thinking} value={value.thinkingLevel} disabled={disabled} className={selectClass}
            onChange={event => onChange({ ...value, thinkingLevel: event.target.value as ThinkingLevel })}>
            {model.thinkingLevels.map(level => <option key={level} value={level}>{copy[level]}</option>)}
          </select>
        </label>}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{copy.moreThinking}</p>
    </div>
  );
}
