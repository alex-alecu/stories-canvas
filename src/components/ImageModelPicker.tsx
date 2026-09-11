import { IMAGE_MODELS } from '../../shared/imageModels';

export default function ImageModelPicker({ value, onChange, disabled, language, dark = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  language: string;
  dark?: boolean;
}) {
  const copy = language === 'ro'
    ? { label: 'Model imagine', fast: 'Rapid', pro: 'Pro' }
    : { label: 'Image model', fast: 'Fast', pro: 'Pro' };
  const families = [...new Set(IMAGE_MODELS.map(model => model.family))];

  return (
    <label className={`min-w-0 text-sm font-semibold ${dark ? 'text-white/70' : 'text-gray-700 dark:text-gray-200'}`}>
      {copy.label}
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        className={dark
          ? 'mt-1.5 w-full min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white focus:border-primary-400 focus:outline-none disabled:opacity-50'
          : 'mt-1.5 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100'}
      >
        {families.map(family => (
          <optgroup key={family} label={family}>
            {IMAGE_MODELS.filter(model => model.family === family).map(model => (
              <option key={model.id} value={model.id}>{model.name} · {copy[model.tier]}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
