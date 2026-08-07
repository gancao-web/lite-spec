import { getCredentialsPath, getLiteSpecHome, updateStoredCredentials } from './runtime-home.js';

export type SaveCredentialsOptions = {
  yapiUid?: string;
  yapiToken?: string;
  figmaToken?: string;
  dingtalkCookie?: string;
  dingtalkXsrfToken?: string;
  dingtalkAToken?: string;
  dingtalkDocKey?: string;
  dingtalkDentryKey?: string;
};

export async function saveCredentials(options: SaveCredentialsOptions): Promise<{
  credentialsPath: string;
  runtimeHome: string;
  saved: {
    yapi: boolean;
    figma: boolean;
    dingtalk: boolean;
  };
}> {
  const yapiUid = options.yapiUid?.trim();
  const yapiToken = options.yapiToken?.trim();
  const figmaToken = options.figmaToken?.trim();
  const dingtalkCookie = options.dingtalkCookie?.trim();
  const dingtalkXsrfToken = options.dingtalkXsrfToken?.trim();
  const dingtalkAToken = options.dingtalkAToken?.trim();
  const dingtalkDocKey = options.dingtalkDocKey?.trim();
  const dingtalkDentryKey = options.dingtalkDentryKey?.trim();

  if ((yapiUid && !yapiToken) || (!yapiUid && yapiToken)) {
    throw new Error('YApi credentials must include both yapiUid and yapiToken.');
  }

  if (!yapiUid && !yapiToken && !figmaToken && !dingtalkCookie) {
    throw new Error('Nothing to save. Provide YApi, Figma, or DingTalk credentials.');
  }

  let savedYapi = false;
  let savedFigma = false;
  let savedDingtalk = false;

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
    if (dingtalkCookie) {
      next.dingtalk = {
        cookie: dingtalkCookie,
        xsrfToken: dingtalkXsrfToken,
        aToken: dingtalkAToken,
        docKey: dingtalkDocKey,
        dentryKey: dingtalkDentryKey,
        updatedAt: new Date().toISOString(),
      };
      savedDingtalk = true;
    }

    return next;
  });

  return {
    credentialsPath: credentialsPath || getCredentialsPath(),
    runtimeHome: getLiteSpecHome(),
    saved: {
      yapi: savedYapi,
      figma: savedFigma,
      dingtalk: savedDingtalk,
    },
  };
}
