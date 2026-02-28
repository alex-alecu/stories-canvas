import { useFontSize, type FontSize } from '../contexts/FontSizeContext';
import { useLanguage } from '../i18n/LanguageContext';

interface FontSizeControlProps {
  variant?: 'default' | 'overlay';
}

const sizes: { value: FontSize; textClass: string }[] = [
  { value: 'small', textClass: 'text-xs' },
  { value: 'medium', textClass: 'text-sm' },
  { value: 'large', textClass: 'text-base' },
];

export default function FontSizeControl({ variant = 'default' }: FontSizeControlProps) {
  const { fontSize, setFontSize } = useFontSize();
  const { t } = useLanguage();

  const labelMap: Record<FontSize, string> = {
    small: t.fontSizeSmall,
    medium: t.fontSizeMedium,
    large: t.fontSizeLarge,
  };

  if (variant === 'overlay') {
    return (
      <div className="flex items-center gap-1 bg-black/60 backdrop-blur-sm rounded-lg p-1">
        {sizes.map((size) => {
          const isActive = fontSize === size.value;
          return (
            <button
              key={size.value}
              onClick={() => setFontSize(size.value)}
              className={`flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 font-bold ${
                isActive
                  ? 'bg-white/20 text-white'
                  : 'text-white/50 hover:text-white/80'
              } ${size.textClass}`}
              title={labelMap[size.value]}
              aria-label={`${t.fontSize}: ${labelMap[size.value]}`}
            >
              A
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 bg-gray-100 dark:bg-surface-dark-accent rounded-lg p-0.5">
      {sizes.map((size) => {
        const isActive = fontSize === size.value;
        return (
          <button
            key={size.value}
            onClick={() => setFontSize(size.value)}
            className={`flex items-center justify-center w-8 h-8 rounded-md transition-all duration-200 font-bold ${
              isActive
                ? 'bg-white dark:bg-surface-dark-elevated text-primary-600 dark:text-primary-400 shadow-sm'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
            } ${size.textClass}`}
            title={labelMap[size.value]}
            aria-label={`${t.fontSize}: ${labelMap[size.value]}`}
          >
            A
          </button>
        );
      })}
    </div>
  );
}
