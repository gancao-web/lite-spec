export type ReflectionCollected = {
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
  raw: Record<string, unknown>;
};

type ReflectionClassInfo = {
  class_explain?: string;
  attention_explain?: string;
  in_protocol_format?: string;
  out_protocol_format?: string;
  update_log?: Array<Record<string, unknown>>;
  sys_status_code?: Record<string, string>;
  api_status_code?: Record<string, string>;
};

export function isReflectionUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.pathname.includes('reflection') &&
      parsed.searchParams.get('ctl') === 'doc' &&
      Boolean(parsed.searchParams.get('c')) &&
      Boolean(parsed.searchParams.get('p'))
    );
  } catch {
    return false;
  }
}

export async function collectReflectionDoc(url: string): Promise<ReflectionCollected> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Reflection doc request failed with HTTP ${response.status}. The document may be unavailable, require login, or require additional credentials.`,
    );
  }

  const html = await response.text();
  const classInfo = extractJsonVariable<ReflectionClassInfo>(html, 'moClassInfo');
  const packageName = extractStringVariable(html, 'msPackageName');
  const query = new URL(url).searchParams;
  const packagePath = query.get('p') || '';
  const className = query.get('c') || '';

  const title = classInfo.class_explain || className || '未命名接口';
  const desc = [classInfo.class_explain, classInfo.attention_explain].filter(Boolean).join('；');
  const requestBody = decodeProtocolFormat(classInfo.in_protocol_format || '');
  const responseBody = decodeProtocolFormat(classInfo.out_protocol_format || '');

  return {
    title,
    method: 'POST',
    path: `${packagePath}.${className}`,
    desc: desc || packageName || className,
    reqBodyType: 'json',
    requestBody,
    responseBody: {
      protocol: responseBody,
      apiStatusCode: classInfo.api_status_code || {},
      systemStatusCode: classInfo.sys_status_code || {},
    },
    reqHeaders: [{ name: 'Content-Type', value: 'application/json', required: '1' }],
    reqQuery: [],
    reqParams: [],
    raw: classInfo as Record<string, unknown>,
  };
}

function extractJsonVariable<T>(html: string, variableName: string): T {
  const pattern = new RegExp(`var\\s+${variableName}\\s*=\\s*(\\{[\\s\\S]*?\\});`);
  const match = html.match(pattern);
  if (!match) {
    throw new Error(
      `Unable to find variable ${variableName} in reflection document. The page may not be a compatible reflection doc, or the document content may require login/credentials to access fully.`,
    );
  }

  return JSON.parse(match[1]) as T;
}

function extractStringVariable(html: string, variableName: string): string {
  const pattern = new RegExp(`var\\s+${variableName}\\s*=\\s*'([^']*)';`);
  const match = html.match(pattern);
  return match?.[1] || '';
}

function decodeProtocolFormat(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}
