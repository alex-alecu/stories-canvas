import sharp from 'sharp';
import type { StoryImageSources } from '../../shared/types.js';
import {
  COVER_IMAGE_VARIANTS,
  getCoverImageVariantFilename,
  type CoverImageVariantKey,
} from '../utils/storyMedia.js';

export const STORY_IMAGES_BUCKET = 'story-images';

interface GenerateCoverImageVariantSourcesOptions {
  sourceBuffer: Buffer;
  fullUrl: string;
  uploadVariant: (variant: {
    key: CoverImageVariantKey;
    filename: string;
    buffer: Buffer;
    contentType: 'image/webp';
  }) => Promise<string>;
}

export async function generateCoverImageVariantSources({
  sourceBuffer,
  fullUrl,
  uploadVariant,
}: GenerateCoverImageVariantSourcesOptions): Promise<StoryImageSources> {
  const sources: StoryImageSources = { full: fullUrl };

  for (const [key, options] of Object.entries(COVER_IMAGE_VARIANTS)) {
    const variantKey = key as CoverImageVariantKey;
    const filename = getCoverImageVariantFilename(variantKey);
    const buffer = await sharp(sourceBuffer)
      .resize({
        width: options.width,
        height: options.height,
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      })
      .webp({
        quality: 74,
        effort: 5,
        smartSubsample: true,
      })
      .toBuffer();

    sources[variantKey] = await uploadVariant({
      key: variantKey,
      filename,
      buffer,
      contentType: 'image/webp',
    });
  }

  return sources;
}
