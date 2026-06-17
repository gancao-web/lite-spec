import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { intakeContextSchema, type IntakeContext } from './context.js';
import { getPlanOutDir } from './paths.js';
import { renderPlan, renderTasks } from './render.js';

export type GenerateOptions = {
  contextData: IntakeContext;
  repo?: string;
  scope?: string;
  slug?: string;
  outDir?: string;
};

export async function runGenerate(options: GenerateOptions): Promise<{
  outDir: string;
}> {
  const outDir = getPlanOutDir({
    repo: options.repo,
    scope: options.scope,
    slug: options.slug,
    outDir: options.outDir,
  });
  const context = intakeContextSchema.parse(options.contextData);

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'plan.md'), `${renderPlan(context)}\n`, 'utf8');
  await writeFile(path.join(outDir, 'tasks.md'), `${renderTasks(context)}\n`, 'utf8');

  return { outDir };
}
