import { ART_STYLES, DEFAULT_ART_STYLE } from '../../shared/types.js';
import type { ArtStyleKey, StoryMeta } from '../../shared/types.js';

export function parseArtStyle(style: string | null | undefined): ArtStyleKey | undefined {
  if (style && style in ART_STYLES) {
    return style as ArtStyleKey;
  }
  return undefined;
}

export function resolveArtStyle(style: string | null | undefined): ArtStyleKey {
  return parseArtStyle(style) ?? DEFAULT_ART_STYLE;
}

export function getArtStyleDescription(style: string | null | undefined): string {
  return ART_STYLES[resolveArtStyle(style)];
}

export function getStoryArtStyleDescription(story: Pick<StoryMeta, 'artStyle'>): string {
  return getArtStyleDescription(story.artStyle);
}
