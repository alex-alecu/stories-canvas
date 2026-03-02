# Plan: Add "Pro" Toggle Switch

Replace the `0/500` character counter with a "Pro" toggle switch (disabled by default). When enabled, the backend uses `IMAGE_MODEL_PRO` instead of `IMAGE_MODEL` for image generation.

## Files to Modify (10 files)

### 1. `shared/types.ts` (line 95-100)
Add `pro?: boolean` to `CreateStoryRequest`:
```ts
export interface CreateStoryRequest {
  prompt: string;
  language?: string;
  age?: number;
  style?: ArtStyleKey;
  pro?: boolean;  // NEW
}
```

### 2. `server/config.ts` (line 21)
Add `imageModelPro` after `imageModel`:
```ts
imageModel: process.env.IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
imageModelPro: process.env.IMAGE_MODEL_PRO || 'gemini-3-pro-image-preview',  // NEW
```

### 3. `server/services/gemini.ts` (line 49-52)
Add `pro?: boolean` parameter to `generateImage()` and conditionally select model:
```ts
export async function generateImage(
  prompt: string,
  referenceImages: Array<{ data: string; mimeType: string }> = [],
  pro?: boolean,  // NEW
): Promise<string> {
  // ...
  const response = await ai.models.generateContent({
    model: pro ? config.imageModelPro : config.imageModel,  // CHANGED
    // ...
  });
```

### 4. `server/services/characterSheet.ts`
Add `pro?: boolean` to both functions, pass to `generateImage()`:

**`generateCharacterSheet`** (line 12-16): add `pro?: boolean` param, line 32: `generateImage(prompt, [], pro)`

**`generateAllCharacterSheets`** (line 45-51): add `pro?: boolean` param, line 59: pass `pro` to `generateCharacterSheet()`

### 5. `server/services/sceneGenerator.ts`
Add `pro?: boolean` to both exported functions, pass to `generateImage()`:

**`generateSceneImage`** (line 105-115): add `pro?: boolean` param, line 153: `generateImage(prompt, referenceImages, pro)`

**`generateAllSceneImages`** (line 199-208): add `pro?: boolean` param, line 219: pass `pro` to `generateSceneImage()`

### 6. `server/routes/stories.ts`
- **Line 217**: Extract `pro` from request body: `const { prompt, language, age, style, pro } = req.body as CreateStoryRequest;`
- **Line 250**: Pass `pro` to pipeline: `runGenerationPipeline(storyId, trimmedPrompt, userId, storyLanguage, storyAge, storyStyle, !!pro)`
- **Line 259**: Add `pro?: boolean` to `runGenerationPipeline()` signature
- **Line 293**: Pass `pro` to `generateAllCharacterSheets(..., pro)`
- **Line ~312**: Pass `pro` to `generateAllSceneImages(..., pro)`

### 7. `src/components/StoryInput.tsx` — UI Changes
- Add state: `const [pro, setPro] = useState(false);`
- Update `StoryInputProps.onSubmit` to: `(prompt: string, age: number, style: ArtStyleKey, pro: boolean) => void`
- Update `handleSubmit` to: `onSubmit(trimmed, age, style, pro);`
- **Replace char counter** (lines 137-139) with Pro toggle (only for auth users):
```tsx
{!isGuest ? (
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <span className="text-sm text-gray-400 dark:text-gray-500">Pro</span>
    <button
      type="button"
      role="switch"
      aria-checked={pro}
      onClick={() => setPro(!pro)}
      disabled={isLoading}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
        pro
          ? 'bg-gradient-to-r from-primary-500 to-primary-600'
          : 'bg-gray-200 dark:bg-gray-700'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          pro ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </label>
) : (
  <span />
)}
```

### 8. `src/pages/Home.tsx` (line 49)
Update callback signature and pass `pro`:
```ts
const handleCreateStory = useCallback(async (prompt: string, age: number, style: ArtStyleKey, pro: boolean) => {
  // ...
  const result = await createStory.mutateAsync({ prompt, language, age, style, pro });
  // ...
}, [createStory, language, requestPermission]);
```

### 9. `src/hooks/useStories.ts` (line 40-45)
Add `pro` to params and JSON body:
```ts
async function createStory(params: { prompt: string; language?: string; age?: number; style?: string; pro?: boolean }): Promise<CreateStoryResponse> {
  // ...
  body: JSON.stringify({ prompt: params.prompt, language: params.language, age: params.age, style: params.style, pro: params.pro }),
  // ...
}
```

### 10. `server/index.ts` (line 38) — Optional
Log pro model at startup:
```ts
console.log(`  Image model (pro): ${config.imageModelPro}`);
```

## Data Flow Summary
```
StoryInput (toggle) → Home.tsx → useStories (fetch) → POST /api/stories
  → routes/stories.ts (extract pro) → runGenerationPipeline(pro)
    → generateAllCharacterSheets(pro) → generateImage(prompt, [], pro)
    → generateAllSceneImages(pro) → generateImage(prompt, refs, pro)
      → gemini.ts: model = pro ? config.imageModelPro : config.imageModel
```
