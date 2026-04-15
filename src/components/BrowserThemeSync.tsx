import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTheme } from '../contexts/ThemeContext';

type AgeGroup = 'toddler' | 'young' | 'older' | 'preteen';

const BROWSER_THEME_COLORS: Record<'light' | 'dark', Record<'default' | AgeGroup | 'story', string>> = {
  light: {
    default: '#faf5ff',
    toddler: '#fce4ec',
    young: '#f3e5f5',
    older: '#e0f2f1',
    preteen: '#e8eaf6',
    story: '#000000',
  },
  dark: {
    default: '#0f0a1a',
    toddler: '#1a0a14',
    young: '#1a0e20',
    older: '#0a1614',
    preteen: '#0e0e1f',
    story: '#000000',
  },
};

function getThemeColorMeta(): HTMLMetaElement {
  let meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  return meta;
}

function getCurrentBrowserColor(pathname: string, resolvedTheme: 'light' | 'dark'): string {
  const root = document.documentElement;

  if (root.classList.contains('story-view')) {
    return BROWSER_THEME_COLORS[resolvedTheme].story;
  }

  if (pathname !== '/') {
    return BROWSER_THEME_COLORS[resolvedTheme].default;
  }

  const ageGroup = root.dataset.ageGroup as AgeGroup | undefined;
  if (!ageGroup) {
    return BROWSER_THEME_COLORS[resolvedTheme].default;
  }

  return BROWSER_THEME_COLORS[resolvedTheme][ageGroup];
}

export default function BrowserThemeSync() {
  const location = useLocation();
  const { resolvedTheme } = useTheme();
  const [htmlStateVersion, setHtmlStateVersion] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setHtmlStateVersion(current => current + 1);
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ['class', 'data-age-group'],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const color = getCurrentBrowserColor(location.pathname, resolvedTheme);
    getThemeColorMeta().setAttribute('content', color);
    document.documentElement.style.backgroundColor = color;
  }, [htmlStateVersion, location.pathname, resolvedTheme]);

  return null;
}
