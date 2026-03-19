# Implementation Plan: Story Debug Modal, Autoplay Fix, Retry System

## Overview

This plan implements 4 features in the StoryViewer, split across multiple commits on a new branch `feat/story-tools-modal-and-autoplay-fix`:

1. **Autoplay behavior change** — play sound on manual page change instead of auto-advancing
2. **Move play button** — from bottom to top-left area when autoplay is on
3. **Backend retry + assets endpoints** — resume failed generation, list character sheets
4. **Unified Story Tools modal** — single top-right button opens modal with retry + image gallery

---

## Commit 1: Change autoplay behavior + move play button

### Problem
Currently autoplay auto-advances to next slide after audio ends (`autoAdvance()` → `slideNext()`). Users want manual page control; autoplay should only mean "auto-play sound when I navigate to a new page."

### Changes to `src/components/StoryViewer.tsx`

1. **Remove `autoAdvance` function** (lines 90-98).

2. **Remove `autoAdvance` from the `ended` event listener** (lines 114-119) — when audio ends, just set `playingPage` to null. Don't call `autoAdvance()`.

3. **`handleSlideChange` stays the same** (lines 141-154) — it already plays audio on slide change when autoPlay is on. This is the desired behavior.

4. **Move play button when autoplay is active:**
   - When `autoPlay === true`: hide the per-page play/pause button from the bottom text overlay. Add a global play/pause button in the top-left HUD (after the autoplay toggle, at ~`left-[11.5rem]`). This button controls the current slide's audio.
   - When `autoPlay === false`: keep bottom per-page play button as-is (current behavior).
   - The top-left play button uses the same HUD style: `bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white w-10 h-10 rounded-full`.

---

## Commit 2: Backend retry endpoint + story assets listing

### New endpoint: `POST /api/stories/:id/retry`

**`server/routes/stories.ts`:**
1. Verify story ownership. Verify status is `completed` or `failed`.
2. Identify what needs retrying:
   - Pages with `status === 'failed'` (missing images)
   - Pages with no `audioUrl` when other pages have audio (missing audio)
3. If nothing to retry, return 200 with `{ retriedImages: 0, retriedAudio: 0 }`.
4. Set story status to `generating_images` (or `generating_audio`), run retry pipeline as background task.
5. Stream progress via SSE (reuse existing `/:id/status` SSE endpoint — the frontend already listens to it via `useStoryGeneration`).

**`server/services/sceneGenerator.ts` — Add `retryFailedSceneImages()` function:**
- Takes story data, failed page numbers, userId, progress callback.
- For each failed page (in page-number order):
  - Find the nearest previous **successful** page. Download its image from Supabase storage → base64 (to use as previous-scene reference).
  - Download character sheets from storage → base64 map.
  - Call existing `generateSceneImage()` with proper references.
  - On success, update page status to `completed` in DB.
- Quality note: Using downloaded compressed PNG vs raw base64 may produce slightly different results, but acceptable for retry.

**`server/services/elevenlabs.ts` — Add `retryMissingAudio()` function:**
- Filter to pages missing `audioUrl`.
- Run `generatePageAudio()` for each.
- Update DB on success.

**`server/services/supabaseStorage.ts` — Add `listStoryFiles()` helper:**
- Calls `supabase.storage.from(BUCKET).list(storagePath)`.
- Returns list of filenames.

### New endpoint: `GET /api/stories/:id/assets`

**`server/routes/stories.ts`:**
1. Verify access (owner or public story).
2. Call `listStoryFiles()` on storage.
3. Filter and categorize:
   - `characterSheets`: files matching `character-sheet-*.png` → extract name, build public URL
   - `pageImages`: files matching `page-*.png` → extract page number, build public URL
4. Return categorized asset list.

### Type additions in `shared/types.ts`

```typescript
export interface StoryAssets {
  characterSheets: { name: string; url: string }[];
  pageImages: { pageNumber: number; url: string }[];
}

export interface RetryStoryResponse {
  status: StoryStatus;
  retriedImages: number;
  retriedAudio: number;
}
```

### New hooks in `src/hooks/useStories.ts`

- `useRetryStory(id)` — mutation calling `POST /api/stories/:id/retry`
- `useStoryAssets(id)` — query calling `GET /api/stories/:id/assets`, enabled only when modal is open

---

## Commit 3: Unified Story Tools modal

### New component: `src/components/StoryToolsModal.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────┐
│  Story Tools                          [X close] │
│                                                 │
│  ┌── RETRY SECTION (only if errors exist) ────┐ │
│  │                                             │ │
│  │  Status: "3 images failed, 2 missing audio" │ │
│  │                                             │ │
│  │  [Retry]   [Back]                           │ │
│  │                                             │ │
│  │  (Progress indicator when retrying)         │ │
│  └─────────────────────────────────────────────┘ │
│                                                 │
│  ── REFERENCE IMAGES ──────────────────────────  │
│                                                 │
│  Grid of character sheets + non-story images    │
│  (clickable to enlarge full-screen)             │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Styling (matching existing patterns):**
- Backdrop: `fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm` (above StoryViewer's z-50)
- Modal card: `bg-surface-dark-elevated rounded-2xl shadow-lg max-w-2xl mx-auto overflow-y-auto max-h-[90vh] p-6`
- Retry button: `bg-primary-500 hover:bg-primary-600 text-white font-bold py-2 px-6 rounded-xl`
- Back button: `bg-white/10 hover:bg-white/20 text-white py-2 px-6 rounded-xl`
- Gallery grid: `grid grid-cols-2 md:grid-cols-3 gap-3`
- Image thumbnails: `rounded-xl overflow-hidden cursor-pointer hover:ring-2 ring-primary-400 transition`
- Image lightbox: `fixed inset-0 z-[70] bg-black/90 flex items-center justify-center`

**Props:**
```typescript
interface StoryToolsModalProps {
  isOpen: boolean;
  onClose: () => void;
  storyId: string;
  scenario: Scenario;
  progress?: GenerationProgress | null;
  isGenerating?: boolean;
}
```

**Retry section behavior:**
- Shown only when `hasErrors` = pages with `status === 'failed'` OR (story has audio pages AND some pages missing `audioUrl`)
- Displays error summary (e.g., "3 failed images, 2 pages missing audio")
- "Retry" triggers `useRetryStory` mutation. While retrying, shows spinner + progress from SSE
- On success: `queryClient.invalidateQueries(['story', storyId])` to refetch story data
- "Back" closes modal

**Gallery section behavior:**
- Always shown
- Fetches via `useStoryAssets(storyId)` (only when modal is open)
- Shows character reference sheets with character name labels
- Loading skeleton while fetching
- Click image → full-screen lightbox overlay

### Changes to `src/components/StoryViewer.tsx`

**Add trigger button in top-right area:**
- Add an icon button next to (or replacing) the title badge at `top-4 right-4`
- Layout: `[title badge] [tools button]` — title shifts left, tools button at far right
- Button style: same HUD pill/circle style (`bg-black/40 hover:bg-black/60 backdrop-blur-sm`)
- Icon: grid/gallery icon (SVG inline, matching existing icon style)
- Red dot indicator when `hasErrors` (small `absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full`)
- State: `const [showTools, setShowTools] = useState(false)`

**Render the modal:**
```tsx
<StoryToolsModal
  isOpen={showTools}
  onClose={() => setShowTools(false)}
  storyId={storyId}
  scenario={scenario}
  progress={progress}
  isGenerating={isGenerating}
/>
```

---

## Commit 4: i18n translation keys

### New keys for `src/i18n/types.ts` and all 19 language files:

| Key | English value |
|-----|---------------|
| `storyTools` | `"Story Tools"` |
| `retry` | `"Retry"` |
| `retryDescription` | `"Some content failed to generate. Retry to complete your story."` |
| `failedImages` | `"failed images"` |
| `missingAudio` | `"pages missing audio"` |
| `retrying` | `"Retrying..."` |
| `retrySuccess` | `"Retry completed successfully!"` |
| `retryFailed` | `"Retry failed. Please try again."` |
| `referenceImages` | `"Reference Images"` |
| `characterSheet` | `"Character Sheet"` |
| `noReferenceImages` | `"No reference images available"` |

**Files modified:** `types.ts` + 19 translation files in `src/i18n/translations/`

Note: The `back` key may already exist — if not, add it. Check existing keys before adding.

---

## Key Technical Decisions

### 1. Retry with reference chaining
Image generation is sequential (each page uses previous page as reference). For retry:
- Download the nearest previous successful page's image from storage → convert to base64
- Download character sheets from storage → base64
- This means retry uses compressed PNG (vs original raw base64), but is acceptable

### 2. "Intermediate images" = Character sheets
The only images generated but not shown in the final story are **character reference sheets** (front/3/4/back view composites used as AI references). These populate the gallery section.

### 3. Modal z-index layering
- StoryViewer: `z-50`
- StoryToolsModal backdrop + card: `z-[60]`
- Image lightbox within modal: `z-[70]`

### 4. Error detection (client-side)
```typescript
const hasErrors = scenario.pages.some(p => p.status === 'failed') ||
  (hasAudio && scenario.pages.some(p => !p.audioUrl));
```

### 5. Assets endpoint gated by modal open state
`useStoryAssets` is only enabled when the modal is open, to avoid unnecessary API calls:
```typescript
useQuery({
  queryKey: ['story-assets', storyId],
  queryFn: ...,
  enabled: isOpen,
})
```

---

## Files Modified/Created Summary

| File | Action | Commit |
|------|--------|--------|
| `src/components/StoryViewer.tsx` | Modified | 1, 3 |
| `server/routes/stories.ts` | Modified | 2 |
| `server/services/sceneGenerator.ts` | Modified | 2 |
| `server/services/elevenlabs.ts` | Modified | 2 |
| `server/services/supabaseStorage.ts` | Modified | 2 |
| `shared/types.ts` | Modified | 2 |
| `src/hooks/useStories.ts` | Modified | 2 |
| `src/components/StoryToolsModal.tsx` | **Created** | 3 |
| `src/i18n/types.ts` | Modified | 4 |
| `src/i18n/translations/*.ts` (19 files) | Modified | 4 |
