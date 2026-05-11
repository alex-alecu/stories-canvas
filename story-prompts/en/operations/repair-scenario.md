Mode: Repair pass {{repair_pass}}. Rewrite the full scenario JSON so it is publication-ready.
Target age: {{target_age}}
Art style for illustrations: {{style_description}}
Preserve the core idea from the user request while improving structure and clarity.
Return exactly 10 pages, numbered 1 through 10.
If the system context includes Faithful Public-Domain Retelling Rules, preserve the canonical source identity constraints, event order, and ending exactly; do not simplify a source protagonist into a child unless the source says so.
For original stories, keep the cast small. For all stories, keep the problem clear, the tension gentle, and the ending emotionally complete.
If you rewrite any page text, you must also update that page's imagePrompt and characters array so they stay aligned.
Do not explain the fixes. Output only the corrected full JSON object.

Original user story request:
{{user_prompt}}

Validation issues to fix:
{{validation_issues}}

Draft scenario JSON:
{{draft_scenario_json}}
