# Stories Canvas

Generate illustrated and narrated stories for children with the help of AI.

## How Story Generation Works

When a user submits a story idea, the app runs through four steps in order: writing the story, drawing character references, drawing each page, and recording narration.

### Step 1 — Write the Story

A large language model receives the user's idea along with the chosen language, target age, and art style. It returns a structured story: a title, a list of characters (each with a detailed appearance and clothing description), and a sequence of pages. Each page has its narration text and an image description that the model wrote specifically for that scene.

The model is limited to a maximum of 3 characters and 20 pages.

### Step 2 — Draw Character Reference Sheets

Before any scene is drawn, the app generates a **character reference sheet** for each character. This is a single image that shows the character from multiple angles (front, side, and back) along with a close-up of their face and a color palette.

These sheets are the **single source of truth** for what each character looks like. Every scene image generated later will receive these sheets as visual input so the image model knows exactly how to draw that character — same colors, same proportions, same outfit — on every page.

### Step 3 — Draw Scene Images

Pages are drawn one at a time, in order. For each page, the image model receives:

1. **Character reference sheets** — for every character that appears in that scene. These always come first and are treated as the highest authority on character appearance.
2. **The first scene image** (from page 3 onward) — used as a **style anchor** so the art style, color saturation, and lighting stay consistent across the whole story.
3. **The previous scene image** — used for **environment continuity** so furniture, objects, and spatial layout stay in the same positions when the location hasn't changed.

The text prompt that accompanies these reference images re-describes each character's full appearance, instructs the model to treat the character sheets as absolute truth (overriding any drift visible in earlier scenes), and asks for a richly detailed background. If a generation is rejected by a safety filter, the prompt is automatically softened and retried.

This layered approach — character sheets for identity, first scene for style, previous scene for environment — is what keeps the story visually consistent from the first page to the last.

### Step 4 — Record Narration

If the user selected a narrator voice, each page's text is sent to a text-to-speech model one page at a time. The app offers several narrator voices (grandma, grandpa, mom, dad, whisper), each with its own tuned speech settings. The resulting audio clips are saved so the story can be played back like an audiobook.

Audio generation is optional and can also be triggered later on an already-finished story.
