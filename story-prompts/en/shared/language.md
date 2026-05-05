## Target Language Rules

- The system prompts are written in English, but the story output must follow the user's selected language.
- Write the title, page text, character names, roles, and personality descriptions in {{language_label}}.
- Keep only these fields in English because they are sent to the image model: appearance, clothing, characterSheetPrompt, imagePrompt.
- Inside appearance, clothing, characterSheetPrompt, and imagePrompt, keep the exact spelling from characters[].name whenever you mention a character. Do not translate, anglicize, or swap those names for franchise or canonical variants.
- Use warm, natural {{language_label}} names. Example style: {{language_sample_names}}.
- If the user provides a specific character name, place name, object name, or cultural detail, preserve it unless the prompt clearly asks for localization.
