import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { readStoredEnum, writeStorageItem } from '../lib/browserStorage';

export type FontSize = 'small' | 'medium' | 'large';

interface FontSizeContextValue {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const STORAGE_KEY = 'stories-canvas:font-size';
const FONT_SIZES = ['small', 'medium', 'large'] as const;

const FontSizeContext = createContext<FontSizeContextValue>({
  fontSize: 'medium',
  setFontSize: () => {},
});

function getStoredFontSize(): FontSize {
  return readStoredEnum(STORAGE_KEY, FONT_SIZES) ?? 'medium';
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>(getStoredFontSize);

  const setFontSize = useCallback((newSize: FontSize) => {
    setFontSizeState(newSize);
    writeStorageItem(STORAGE_KEY, newSize);
  }, []);

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
}

export function useFontSize() {
  return useContext(FontSizeContext);
}
