import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROMPT_DIR = join(process.cwd(), 'story-prompts');

export function loadPromptMarkdown(filename: string): string {
  return readFileSync(join(PROMPT_DIR, filename), 'utf8').trimEnd();
}

export function renderPromptTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match
  ));
}
