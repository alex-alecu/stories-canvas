import { useEffect, useId, useRef } from 'react';
import { DEFAULT_TEXT_MODEL, TEXT_MODELS, TEXT_MODEL_PRICES_CHECKED_AT, textModelPriceLevel, parseTextModelSettings, type TextModelSettings, type ThinkingLevel } from '../../shared/textModels';
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
  const menu = useRef<HTMLDetailsElement>(null);
  const pickerId = useId();
  const rateText = (pricing: typeof model.pricing) => `${copy.input} $${pricing.inputUsdPerMillion} · ${copy.output} $${pricing.outputUsdPerMillion}`;
  const closeMenu = () => { if (menu.current) menu.current.open = false; };
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  useEffect(() => { if (disabled) closeMenu(); }, [disabled]);
  const selectClass = 'mt-1.5 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100';
  return (
    <div className="rounded-2xl bg-gray-50 p-4 dark:bg-white/5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 text-sm text-gray-700 dark:text-gray-200">
          <span id={`${pickerId}-label`} className="font-semibold">{copy.model}</span>
          <details ref={menu} className="relative"
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); }}
            onKeyDown={event => {
              if (event.key === 'Escape' || (event.key === 'Enter' && event.target instanceof HTMLInputElement)) {
                event.preventDefault(); closeMenu(); menu.current?.querySelector('summary')?.focus();
              }
            }}>
            <summary aria-labelledby={`${pickerId}-label ${pickerId}-value`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
              onClick={event => { if (disabled) event.preventDefault(); }}
              className={`${selectClass} flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden ${disabled ? 'cursor-default opacity-50' : ''}`}>
              <span id={`${pickerId}-value`} className="min-w-0 flex-1 truncate">{model.name}</span>
              <span className="font-semibold text-primary-700 dark:text-primary-300">{textModelPriceLevel(model)}</span>
              <span aria-hidden="true" className="text-gray-400">⌄</span>
            </summary>
            <fieldset disabled={disabled} aria-labelledby={`${pickerId}-label`}
              className="relative z-30 mt-2 rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm dark:border-gray-700 dark:bg-surface-dark-elevated">
              {TEXT_MODELS.map((option, index) => <label key={option.id}
                className="group relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 hover:bg-primary-50 focus-within:bg-primary-50 dark:hover:bg-white/10 dark:focus-within:bg-white/10">
                <input type="radio" name={pickerId} value={option.id} checked={value.textModel === option.id}
                  aria-describedby={`${pickerId}-price-${index}`} className="h-3.5 w-3.5 shrink-0 accent-primary-600"
                  onChange={() => onChange(parseTextModelSettings(option.id, undefined))}
                  onClick={event => { if (event.detail > 0) { closeMenu(); menu.current?.querySelector('summary')?.focus(); } }} />
                <span className="min-w-0 flex-1">
                  <span className="block">{option.name}</span>
                  {option.id === DEFAULT_TEXT_MODEL && <span className="text-xs text-primary-600 dark:text-primary-300">{copy.modelDefault}</span>}
                </span>
                <span className="font-semibold text-primary-700 dark:text-primary-300">{textModelPriceLevel(option)}</span>
                <span id={`${pickerId}-price-${index}`} role="tooltip"
                  className="pointer-events-none absolute inset-x-0 top-full z-40 hidden rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block dark:bg-gray-100 dark:text-gray-900">
                  <span className="block font-bold">{rateText(option.pricing)}</span>
                  <span className="block">{copy.perMillion}</span>
                  {option.pricing.longContext && <span className="mt-1 block">
                    {copy.aboveInput.replace('{tokens}', option.pricing.longContext.aboveInputTokens.toLocaleString(language))}: {rateText(option.pricing.longContext)}
                  </span>}
                  <span className="mt-1 block opacity-80">{copy.priceNote}</span>
                </span>
              </label>)}
            </fieldset>
          </details>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{rateText(model.pricing)}<br />{copy.perMillion}</p>
        </div>
        {model.thinkingLevels.length > 0 && <label className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
          {copy.thinking}
          <select aria-label={copy.thinking} value={value.thinkingLevel} disabled={disabled} className={selectClass}
            onChange={event => onChange({ ...value, thinkingLevel: event.target.value as ThinkingLevel })}>
            {model.thinkingLevels.map(level => <option key={level} value={level}>{copy[level]}</option>)}
          </select>
        </label>}
      </div>
      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{copy.moreThinking}</p>
      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {copy.baseRates} · {copy.pricesChecked} {TEXT_MODEL_PRICES_CHECKED_AT}
      </p>
    </div>
  );
}
