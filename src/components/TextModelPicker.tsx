import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_TEXT_MODEL, TEXT_MODELS, TEXT_MODEL_PRICES_CHECKED_AT, textModelPriceLevel, parseTextModelSettings, type TextModelSettings, type ThinkingLevel } from '../../shared/textModels';
import { getWalletCopy } from '../i18n/walletCopy';
import { getStoryInputCopy } from '../i18n/storyInputCopy';
import { useLanguage } from '../i18n/LanguageContext';

export default function TextModelPicker({ value, onChange, disabled }: {
  value: TextModelSettings;
  onChange: (value: TextModelSettings) => void;
  disabled: boolean;
}) {
  const { language } = useLanguage();
  const copy = getWalletCopy(language);
  const formCopy = getStoryInputCopy(language);
  const model = TEXT_MODELS.find(item => item.id === value.textModel)!;
  const menu = useRef<HTMLDetailsElement>(null);
  const options = useRef<HTMLFieldSetElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const pickerId = useId();
  const rateText = (pricing: typeof model.pricing) => `${copy.input} $${pricing.inputUsdPerMillion} · ${copy.output} $${pricing.outputUsdPerMillion}`;
  const closeMenu = useCallback(() => {
    if (menu.current) menu.current.open = false;
    setIsOpen(false);
  }, []);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !options.current?.contains(event.target as Node)) closeMenu();
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [closeMenu]);
  useEffect(() => { if (disabled) closeMenu(); }, [disabled, closeMenu]);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const popup = options.current;
    const trigger = menu.current?.querySelector('summary');
    if (!popup || !trigger) return;
    const viewport = window.visualViewport;
    const placeMenu = () => {
      const rect = trigger.getBoundingClientRect();
      const viewTop = viewport?.offsetTop ?? 0;
      const viewLeft = viewport?.offsetLeft ?? 0;
      const viewWidth = viewport?.width ?? window.innerWidth;
      const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
      if (!rect.height || rect.bottom < viewTop || rect.top > viewBottom) {
        closeMenu();
        return;
      }
      const width = Math.min(viewWidth - 24, Math.max(rect.width, 360));
      const above = rect.top - viewTop - 20;
      const below = viewBottom - rect.bottom - 20;
      const openAbove = below < 320 && above > below;
      Object.assign(popup.style, {
        left: `${Math.max(viewLeft + 12, Math.min(rect.left, viewLeft + viewWidth - width - 12))}px`,
        width: `${width}px`,
        maxHeight: `${Math.max(0, Math.min(420, openAbove ? above : below))}px`,
        top: openAbove ? 'auto' : `${rect.bottom + 8}px`,
        bottom: openAbove ? `${window.innerHeight - rect.top + 8}px` : 'auto',
      });
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !popup.contains(event.target)) placeMenu();
    };
    placeMenu();
    const selected = popup.querySelector<HTMLInputElement>('input:checked');
    selected?.focus({ preventScroll: true });
    if (selected) popup.scrollTop += selected.getBoundingClientRect().top - popup.getBoundingClientRect().top - popup.clientHeight / 2;
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', onScroll, true);
    viewport?.addEventListener('resize', placeMenu);
    viewport?.addEventListener('scroll', placeMenu);
    return () => {
      window.removeEventListener('resize', placeMenu);
      window.removeEventListener('scroll', onScroll, true);
      viewport?.removeEventListener('resize', placeMenu);
      viewport?.removeEventListener('scroll', placeMenu);
    };
  }, [isOpen, closeMenu]);
  const selectClass = 'mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base sm:text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100';
  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 text-sm text-gray-700 dark:text-gray-200">
          <span id={`${pickerId}-label`} className="font-semibold">{copy.model}</span>
          <details ref={menu} className="relative"
            onToggle={event => setIsOpen(event.currentTarget.open)}
            onBlur={event => {
              // WebKit can blur the summary before a label activates its radio.
              // A null target is not an outside focus move; pointerdown handles outside clicks.
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && !options.current?.contains(event.relatedTarget as Node)) closeMenu();
            }}
            onKeyDown={event => {
              if (event.key === 'Tab' && options.current?.contains(event.target as Node)) {
                closeMenu();
                menu.current?.querySelector('summary')?.focus();
                return;
              }
              if (event.key === 'Escape' || (event.key === 'Enter' && event.target instanceof HTMLInputElement)) {
                event.preventDefault(); closeMenu(); menu.current?.querySelector('summary')?.focus();
              }
            }}>
            <summary aria-labelledby={`${pickerId}-label ${pickerId}-value`} aria-controls={`${pickerId}-options`} aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
              onClick={event => { if (disabled) event.preventDefault(); }}
              className={`${selectClass} flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden ${disabled ? 'cursor-default opacity-50' : ''}`}>
              <span id={`${pickerId}-value`} className="min-w-0 flex-1 truncate">{model.name}</span>
              <span aria-hidden="true" className="text-gray-400">⌄</span>
            </summary>
            {isOpen && createPortal(<fieldset ref={options} id={`${pickerId}-options`} disabled={disabled} aria-labelledby={`${pickerId}-label`}
              className="fixed z-50 m-0 min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-gray-200 bg-white p-1.5 text-base text-gray-800 shadow-xl sm:text-sm dark:border-gray-700 dark:bg-surface-dark-elevated dark:text-gray-100">
              {TEXT_MODELS.map((option, index) => <label key={option.id}
                className="group relative flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-primary-50 focus-within:bg-primary-50 dark:hover:bg-white/10 dark:focus-within:bg-white/10">
                <input type="radio" name={pickerId} value={option.id} checked={value.textModel === option.id}
                  aria-describedby={`${pickerId}-price-${index}`} className="h-4 w-4 shrink-0 accent-primary-600"
                  onChange={() => onChange(parseTextModelSettings(option.id, undefined))}
                  onClick={event => { if (event.detail > 0) { closeMenu(); menu.current?.querySelector('summary')?.focus(); } }} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>{option.name}</span>
                    {option.id === DEFAULT_TEXT_MODEL && <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-600 dark:bg-primary-500/10 dark:text-primary-300">{copy.modelDefault}</span>}
                  </span>
                  <span id={`${pickerId}-price-${index}`} className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{rateText(option.pricing)}</span>
                </span>
                <span className="font-semibold text-primary-700 dark:text-primary-300">{textModelPriceLevel(option)}</span>
              </label>)}
              <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500 dark:border-white/10 dark:text-gray-400">{copy.perMillion}</p>
            </fieldset>, document.body)}
          </details>
        </div>
        {model.thinkingLevels.length > 0 && <label className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
          {copy.thinking}
          <select aria-label={copy.thinking} value={value.thinkingLevel} disabled={disabled} className={selectClass}
            onChange={event => onChange({ ...value, thinkingLevel: event.target.value as ThinkingLevel })}>
            {model.thinkingLevels.map(level => <option key={level} value={level}>{copy[level]}</option>)}
          </select>
        </label>}
      </div>
      <details className="group/pricing mt-1 text-xs text-gray-500 dark:text-gray-400">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-200 [&::-webkit-details-marker]:hidden">
          <span>{formCopy.modelPricing}</span>
          <span aria-hidden="true" className="transition-transform group-open/pricing:rotate-180">⌄</span>
        </summary>
        <div className="space-y-1 pb-2 leading-relaxed">
          <p className="font-medium text-gray-600 dark:text-gray-300">{model.name}: {rateText(model.pricing)}</p>
          {model.pricing.longContext && <p>
            {copy.aboveInput.replace('{tokens}', model.pricing.longContext.aboveInputTokens.toLocaleString(language))}: {rateText(model.pricing.longContext)}
          </p>}
          <p>{copy.perMillion}</p>
          <p>{copy.moreThinking} {copy.priceNote}</p>
          <p>{copy.baseRates} · {copy.pricesChecked} {TEXT_MODEL_PRICES_CHECKED_AT}</p>
        </div>
      </details>
    </div>
  );
}
