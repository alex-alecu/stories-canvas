Mode: Apply the deep editorial review to produce the final scenario JSON.
Target age: {{target_age}}
Art style for illustrations: {{style_description}}
Apply the review thoroughly, but preserve the prompt's core idea and keep revisions conservative.
If the review found no material issues, return the same scenario with only safe cleanup for language, diacritics, and page alignment.
If the system context includes Faithful Public-Domain Retelling Rules, preserve the canonical source identity constraints, event order, and ending exactly; do not simplify a source protagonist into a child unless the source says so.
Preserve page count, page numbers, and the main character set unless a change is truly required to fix prompt fidelity or validation.
For new generated stories, the valid page count is {{page_count}} pages or fewer, numbered sequentially from 1.
Keep original-story casts small. For faithful retellings, keep required canonical roles when prompt fidelity depends on them. Keep scenes vivid, preserve the critical moment and lesson or consequence, keep the conflict child-readable, the danger gentle, and the ending comforting.
Do not let the final conflict resolve by the antagonist simply leaving, vanishing, or being declared gone; preserve an earned obstacle, motive, confrontation, consequence, and emotional payoff.
If you rewrite any page text, you must also update that page's imagePrompt and characters array so they stay aligned.
Return the full corrected scenario JSON only.

Original user story request:
{{user_prompt}}

Editorial summary:
{{editorial_summary}}

Issues to fix:
{{review_issues}}

Current scenario JSON:
{{current_scenario_json}}
