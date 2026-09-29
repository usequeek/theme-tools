import * as p from '@clack/prompts';
import { relative } from 'node:path';
import {
  designsOf,
  groupTemplates,
  loadContext,
  type ThemeTemplate,
} from '@usequeek/theme-check';
import type { AddPlan } from '@usequeek/create-theme';

/** A clack answer, or exit 130 when the run is cancelled — create exits 130 on Ctrl-C too. */
export function answer<T>(value: T | symbol, error: (message: string, options: { exit: number }) => never): T {
  if (p.isCancel(value)) error('Cancelled. Nothing was written.', { exit: 130 });
  return value as T;
}

/** In a terminal (and without --yes) the command asks; otherwise it never prompts. */
export function isInteractive(yes: boolean | undefined): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !yes;
}

/** Every template of the theme, for the pickers. Tolerates a config the planner will refuse. */
export async function readTemplates(themeDir: string): Promise<ThemeTemplate[]> {
  try {
    const context = await loadContext(themeDir);
    if (context.themeConfig === null || context.declaredDemos === null) return [];
    return groupTemplates(designsOf({ ...(context.themeConfig as Record<string, unknown>), demos: context.declaredDemos }));
  } catch {
    return [];
  }
}

/** This design's file, as check prints it. */
export function designFile(id: string): string {
  return id === 'default' ? 'theme/demo.json' : `theme/demos/${id}.json`;
}

/** A plan's files, relative to where the command ran (like `package --json`). */
export function relativeFiles(plan: AddPlan): string[] {
  return plan.files.map((file) => relative(process.cwd(), file));
}

const CHECK_LINE = 'Then run: queek theme check';

/** What `queek theme check` will now ask for, and the screenshot command — printed after every write. */
export function nextSteps(plan: AddPlan): string[] {
  const added = plan.added as { type: string; id?: string; template?: string; page?: string; design?: string; first_label?: string; first_design?: string };
  if (added.type === 'template' || added.type === 'design') {
    const id = added.id as string;
    const lines = [
      `Write the description in theme.config.ts (demos[${id}].description) — \`queek theme check\` asks for it.`,
      `Replace the placeholder products and photos in ${designFile(id)} with your own.`,
      `Capture its screenshot: queek theme screenshot ${id}`,
      CHECK_LINE,
    ];
    if (added.type === 'design' && added.first_label !== undefined) {
      lines.unshift(`Named the template's first design "${added.first_design}" too: "${added.first_label}".`);
    }
    return lines;
  }
  return [
    'Fill in the page for the store, then preview it: queek theme dev',
    CHECK_LINE,
  ];
}

export function heading(plan: AddPlan): string {
  const added = plan.added as { type: string; id?: string; template?: string; page?: string; design?: string };
  if (added.type === 'template') return `Added template "${added.template}" (design "${added.id}", ${designFile(added.id as string)}).`;
  if (added.type === 'design') return `Added design "${added.id}" to template "${added.template}" (${designFile(added.id as string)}).`;
  return `Added the ${added.page} page to design "${added.design}" (${designFile(added.design as string)}).`;
}

export function dryRunLines(plan: AddPlan): string[] {
  const lines = [heading(plan).replace(/^Added/, 'Would add')];
  for (const file of relativeFiles(plan)) lines.push(`  write ${file}`);
  return lines;
}
