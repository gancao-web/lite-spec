import { getCredentialsPath, getLiteSpecHome, updateStoredCredentials } from './runtime-home.js';

export type SaveCredentialsOptions = {
  yapiUid?: string;
  yapiToken?: string;
  figmaToken?: string;
};

export async function saveCredentials(options: SaveCredentialsOptions): Promise<{
  credentialsPath: string;
  runtimeHome: string;
  saved: {
    yapi: boolean;
    figma: boolean;
  };
}> {
  const yapiUid = options.yapiUid?.trim();
  const yapiToken = options.yapiToken?.trim();
  const figmaToken = options.figmaToken?.trim();

  if ((yapiUid && !yapiToken) || (!yapiUid && yapiToken)) {
    throw new Error('YApi credentials must include both yapiUid and yapiToken.');
  }

  if (!yapiUid && !yapiToken && !figmaToken) {
    throw new Error('Nothing to save. Provide YApi or Figma credentials.');
  }

  let savedYapi = false;
  let savedFigma = false;

  const credentialsPath = await updateStoredCredentials((current) => {
    const next = { ...current };

    if (yapiUid && yapiToken) {
      next.yapi = {
        uid: yapiUid,
        token: yapiToken,
        updatedAt: new Date().toISOString(),
      };
      savedYapi = true;
    }

    if (figmaToken) {
      next.figma = {
        token: figmaToken,
        updatedAt: new Date().toISOString(),
      };
      savedFigma = true;
    }

    return next;
  });

  return {
    credentialsPath: credentialsPath || getCredentialsPath(),
    runtimeHome: getLiteSpecHome(),
    saved: {
      yapi: savedYapi,
      figma: savedFigma,
    },
  };
}
