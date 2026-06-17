import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCollect, runGenerate } from './index.js';

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'lite-spec-smoke-'));

try {
  const repo = path.join(tmpRoot, 'repo');
  await mkdir(repo, { recursive: true });
  await writeFile(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ scripts: { test: 'echo ok' } }, null, 2)}\n`,
    'utf8',
  );

  const collectResult = await runCollect({
    repo,
    scope: 'Smoke test demand',
    slug: 'smoke-test',
  });

  const generateResult = await runGenerate({
    contextData: collectResult.context,
    repo,
    scope: 'Smoke test demand',
    slug: 'smoke-test',
    outDir: collectResult.outDir,
  });

  const planPath = path.join(generateResult.outDir, 'plan.md');
  const tasksPath = path.join(generateResult.outDir, 'tasks.md');
  const plan = await readFile(planPath, 'utf8');
  const tasks = await readFile(tasksPath, 'utf8');

  if (!plan.includes('# 需求整理')) {
    throw new Error('Smoke test failed: plan.md missing expected title');
  }
  if (!tasks.includes('# 任务清单')) {
    throw new Error('Smoke test failed: tasks.md missing expected title');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: generateResult.outDir,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tmpRoot, { recursive: true, force: true });
}
