import path from 'node:path';

type PlanOutDirInput = {
  repo?: string;
  scope?: string;
  slug?: string;
  outDir?: string;
};

export function getPlanOutDir(input: PlanOutDirInput): string {
  if (input.outDir) {
    return path.resolve(process.cwd(), input.outDir);
  }

  if (!input.repo) {
    throw new Error('Missing repo. The default output path requires a target repository.');
  }

  const repo = path.resolve(input.repo);
  const scopeSource = input.slug || input.scope || '';
  const scopeSlug = toScopeSlug(scopeSource);
  if (!scopeSlug) {
    throw new Error('Unable to derive a plan slug. Please provide scope or slug.');
  }

  return path.join(repo, 'plans', `${getDatePrefix()}-${scopeSlug}`);
}

export const getSpecOutDir = getPlanOutDir;

function toScopeSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (normalized) {
    return normalized;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  return `spec-${hashToBase36(trimmed)}`;
}

function getDatePrefix(date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hashToBase36(value: string): string {
  let hash = 2166136261;

  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
