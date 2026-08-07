import { getCredentialsPath, getLiteSpecHome, updateStoredCredentials } from './runtime-home.js';

export type SaveCredentialsOptions = {
  webHost?: string;
  webUrl?: string;
  webCookie?: string;
  webHeadersJson?: string;
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
    web: boolean;
    yapi: boolean;
    figma: boolean;
    dingtalk: boolean;
  };
}> {
  const yapiUid = options.yapiUid?.trim();
  const webHost = options.webHost?.trim().toLowerCase();
  const webUrl = options.webUrl?.trim();
  const webCookie = options.webCookie?.trim();
  const webHeadersJson = options.webHeadersJson?.trim();
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

  if (!webHost && !yapiUid && !yapiToken && !figmaToken && !dingtalkCookie) {
    throw new Error('Nothing to save. Provide generic web, YApi, Figma, or DingTalk credentials.');
  }

  if (webHost && !webUrl) throw new Error('Generic web credentials require webUrl.');
  let webHeaders: Record<string, string> | undefined;
  if (webHeadersJson) {
    const parsed = JSON.parse(webHeadersJson) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('webHeadersJson must be a JSON object.');
    }
    webHeaders = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    );
  }

  let savedYapi = false;
  let savedFigma = false;
  let savedDingtalk = false;
  let savedWeb = false;

  const credentialsPath = await updateStoredCredentials((current) => {
    const next = { ...current };

    if (webHost && webUrl) {
      next.web = {
        ...(current.web ?? {}),
        [webHost]: {
          url: webUrl,
          cookie: webCookie,
          headers: webHeaders,
          updatedAt: new Date().toISOString(),
        },
      };
      savedWeb = true;
    }

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
      web: savedWeb,
      yapi: savedYapi,
      figma: savedFigma,
      dingtalk: savedDingtalk,
    },
  };
}
