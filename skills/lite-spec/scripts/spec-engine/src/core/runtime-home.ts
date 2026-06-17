import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type LiteSpecCredentials = {
  yapi?: {
    uid: string;
    token: string;
    updatedAt?: string;
  };
  figma?: {
    token: string;
    updatedAt?: string;
  };
};

export function getLiteSpecHome(): string {
  const explicitHome = process.env.LITE_SPEC_HOME?.trim();
  if (explicitHome) return path.resolve(explicitHome);

  const sharedHome = process.env.AI_SKILLS_HOME?.trim();
  if (sharedHome) return path.resolve(sharedHome, 'lite-spec');

  return path.join(os.homedir(), '.ai-skills', 'lite-spec');
}

export function getLiteSpecConfigDir(): string {
  return path.join(getLiteSpecHome(), 'config');
}

export function getCredentialsPath(): string {
  return path.join(getLiteSpecConfigDir(), 'credentials.json');
}

export function getLiteSpecCacheDir(): string {
  return path.join(getLiteSpecHome(), 'cache');
}

export async function readStoredCredentials(): Promise<LiteSpecCredentials> {
  const filePath = getCredentialsPath();
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as LiteSpecCredentials;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

export async function writeStoredCredentials(next: LiteSpecCredentials): Promise<string> {
  const configDir = getLiteSpecConfigDir();
  await mkdir(configDir, { recursive: true });

  const filePath = getCredentialsPath();
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return filePath;
}

export async function updateStoredCredentials(
  updater: (current: LiteSpecCredentials) => LiteSpecCredentials,
): Promise<string> {
  const current = await readStoredCredentials();
  return writeStoredCredentials(updater(current));
}
