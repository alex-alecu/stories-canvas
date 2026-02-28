import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type FontSize = 'small' | 'medium' | 'large';

interface FontSizeContextValue {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const STORAGE_KEY = 'stories-canvas:font-size';

const FontSizeContext = createContext<FontSizeContextValue>({
  fontSize: 'medium',
  setFontSize: () => {},
});

function getStoredFontSize(): FontSize {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'small' || stored === 'medium' || stored === 'large') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'medium';
}

export function FontSizeProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>(getStoredFontSize);

  const setFontSize = useCallback((newSize: FontSize) => {
    setFontSizeState(newSize);
    try {
      localStorage.setItem(STORAGE_KEY, newSize);
    } catch {
      // localStorage unavailable
    }
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
