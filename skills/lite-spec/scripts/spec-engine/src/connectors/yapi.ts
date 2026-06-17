type YApiAuth = {
  uid: string;
  token: string;
};

export type YApiAuthSource = 'input' | 'runtime' | 'env';

export class YApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YApiAuthError';
  }
}

type YApiInterfaceResponse = {
  errcode: number;
  errmsg: string;
  data: {
    _id: number;
    title: string;
    method: string;
    path: string;
    desc: string;
    req_body_type?: string;
    req_body_other?: string;
    res_body?: string;
    req_headers?: Array<{ name: string; value: string; required?: string }>;
    req_query?: Array<{ name: string; desc?: string; required?: string }>;
    req_params?: Array<{ name: string; desc?: string; required?: string }>;
  } | null;
};

export type YApiCollected = {
  interfaceId: number;
  title: string;
  method: string;
  path: string;
  desc: string;
  reqBodyType: string;
  requestBody: unknown;
  responseBody: unknown;
  reqHeaders: Array<{ name: string; value: string; required?: string }>;
  reqQuery: Array<{ name: string; desc?: string; required?: string }>;
  reqParams: Array<{ name: string; desc?: string; required?: string }>;
};

export function parseYApiInterfaceId(url: string): number | null {
  const fromQuery = /[?&]id=(\d+)/.exec(url);
  if (fromQuery) return Number(fromQuery[1]);

  const fromPath = /\/interface\/api\/(\d+)/.exec(url);
  if (fromPath) return Number(fromPath[1]);

  return null;
}

export function getYApiAuthFromEnv(): YApiAuth | null {
  const uid = process.env.YAPI_UID?.trim();
  const token = process.env.YAPI_TOKEN?.trim();

  if (!uid || !token) return null;
  return { uid, token };
}

export function isCompleteYApiAuth(value: Partial<YApiAuth> | null | undefined): value is YApiAuth {
  return Boolean(value?.uid?.trim() && value?.token?.trim());
}

export async function collectYApiInterface(url: string, auth: YApiAuth): Promise<YApiCollected> {
  const interfaceId = parseYApiInterfaceId(url);
  if (!interfaceId) {
    throw new Error(`Unable to parse YApi interface id from URL: ${url}`);
  }

  const apiUrl = new URL('/api/interface/get', url);
  apiUrl.searchParams.set('id', String(interfaceId));

  const response = await fetch(apiUrl, {
    headers: {
      Cookie: `_yapi_uid=${auth.uid}; _yapi_token=${auth.token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`YApi request failed with HTTP ${response.status}`);
  }

  const result = (await response.json()) as YApiInterfaceResponse;
  if (result.errcode === 40011) {
    throw new YApiAuthError(
      'YApi login expired or invalid. Please refresh YAPI_UID/YAPI_TOKEN and rerun.',
    );
  }
  if (result.errcode !== 0 || !result.data) {
    throw new Error(`YApi error ${result.errcode}: ${result.errmsg}`);
  }

  return {
    interfaceId,
    title: result.data.title,
    method: result.data.method,
    path: result.data.path,
    desc: result.data.desc,
    reqBodyType: result.data.req_body_type ?? '',
    requestBody: tryParseJson(result.data.req_body_other),
    responseBody: tryParseJson(result.data.res_body),
    reqHeaders: result.data.req_headers ?? [],
    reqQuery: result.data.req_query ?? [],
    reqParams: result.data.req_params ?? [],
  };
}

function tryParseJson(value?: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
