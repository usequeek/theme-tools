/**
 * `queek-theme-disable-next-line` comments: what they name, and how far one
 * rule id is from another (for "did you mean" suggestions).
 *
 * Pure string handling — no filesystem, no rule registry — so both the
 * `theme/disable-comment` rule and the `applyDisableComments` library use it
 * without pulling in the rule list.
 */

/** One disable comment: the 1-based line it sits on, and the rule ids it names. */
export interface DisableDirective {
  line: number;
  rules: string[];
}

/** A token that names a rule (`theme/x`, letters/digits/`-`/`_`). Anything else is ignored. */
const RULE_TOKEN = /theme\/[\w-]+/g;

function lineOf(source: string, offset: number): number {
  return source.slice(0, offset).split('\n').length;
}

/** `// queek-theme-disable-next-line theme/a, theme/b` (`.ts`/`.tsx`/`.js`…). */
export function tsDisableDirectives(source: string): DisableDirective[] {
  const found: DisableDirective[] = [];
  const lines = source.split('\n');
  lines.forEach((text, index) => {
    const marker = text.indexOf('queek-theme-disable-next-line');
    if (marker === -1 || !text.slice(0, marker).includes('//')) return;
    const rules = text.slice(marker).match(RULE_TOKEN) ?? [];
    if (rules.length > 0) found.push({ line: index + 1, rules });
  });
  return found;
}

/** `/* queek-theme-disable-next-line theme/a *\/` (`.css`). */
export function cssDisableDirectives(source: string): DisableDirective[] {
  const found: DisableDirective[] = [];
  for (const match of source.matchAll(/\/\*\s*queek-theme-disable-next-line([\s\S]*?)\*\//g)) {
    const rules = match[1]?.match(RULE_TOKEN) ?? [];
    if (rules.length > 0 && match.index !== undefined) found.push({ line: lineOf(source, match.index), rules });
  }
  return found;
}

/** Plain Levenshtein edit distance, for "did you mean" suggestions. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j] ?? 0;
      prev[j] = Math.min(above + 1, (prev[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length] ?? 0;
}

/** The known id closest to `id` by edit distance, or null when there are no candidates. */
export function closestRuleId(id: string, known: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of known) {
    const distance = editDistance(id, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
