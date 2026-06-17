export type OpenApiCollectedOperation = {
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
  operationId: string;
};

export type OpenApiCollected = OpenApiCollectedOperation & {
  sourceType: 'openapi';
  specTitle: string;
  specVersion: string;
  specUrl: string;
  operations: OpenApiCollectedOperation[];
  raw: Record<string, unknown>;
};

type OpenApiSpec = {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  paths?: Record<string, Record<string, OpenApiOperation | undefined> | undefined>;
  components?: {
    schemas?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
    requestBodies?: Record<string, unknown>;
    responses?: Record<string, unknown>;
  };
  definitions?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  responses?: Record<string, unknown>;
};

type OpenApiOperation = {
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: Record<string, unknown>;
  consumes?: string[];
  produces?: string[];
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export function isOpenApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.toLowerCase();
    return (
      pathname.endsWith('/doc.html') ||
      pathname.endsWith('/swagger-ui.html') ||
      pathname.includes('/swagger-ui/') ||
      pathname.includes('/api-docs') ||
      pathname.includes('/openapi') ||
      pathname.endsWith('swagger.json') ||
      pathname.endsWith('openapi.json')
    );
  } catch {
    return false;
  }
}

export async function collectOpenApiDoc(url: string): Promise<OpenApiCollected> {
  try {
    const resolved = await resolveOpenApiSpec(url);
    const operations = extractOperations(resolved.spec);

    if (!operations.length) {
      throw new Error(`OpenAPI spec did not contain any operations: ${resolved.specUrl}`);
    }

    const primary = operations[0];

    return {
      ...primary,
      sourceType: 'openapi',
      specTitle: resolved.spec.info?.title?.trim() || '未命名 OpenAPI 文档',
      specVersion:
        resolved.spec.info?.version?.trim() || resolved.spec.openapi || resolved.spec.swagger || '',
      specUrl: resolved.specUrl,
      operations,
      raw: resolved.spec as Record<string, unknown>,
    };
  } catch (error) {
    if (!isKnife4jDocPage(url)) {
      throw error;
    }

    return await collectKnife4jDocPage(url, error);
  }
}

async function resolveOpenApiSpec(url: string): Promise<{ specUrl: string; spec: OpenApiSpec }> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json, text/html;q=0.9, */*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`OpenAPI/Swagger request failed with HTTP ${response.status}: ${url}`);
  }

  const finalUrl = response.url || url;
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();

  const spec = tryParseSpecText(body);
  if (spec) {
    return { specUrl: finalUrl, spec };
  }

  if (!looksLikeHtml(contentType, body)) {
    throw new Error(
      `Unsupported OpenAPI/Swagger content at ${finalUrl}. JSON spec or Swagger UI page expected.`,
    );
  }

  const specUrl = await resolveSpecUrlFromDocPage(finalUrl, body);
  const specResponse = await fetch(specUrl, {
    headers: {
      Accept: 'application/json, */*;q=0.8',
    },
  });

  if (!specResponse.ok) {
    throw new Error(`Swagger UI spec request failed with HTTP ${specResponse.status}: ${specUrl}`);
  }

  const specText = await specResponse.text();
  const swaggerSpec = tryParseSpecText(specText);
  if (!swaggerSpec) {
    throw new Error(
      `Swagger UI resolved spec is not valid JSON OpenAPI/Swagger content: ${specUrl}`,
    );
  }

  return {
    specUrl,
    spec: swaggerSpec,
  };
}

async function collectKnife4jDocPage(
  url: string,
  originalError: unknown,
): Promise<OpenApiCollected> {
  const browserCollected = await tryCollectKnife4jViaBrowser(url);
  if (!browserCollected) {
    const reason = originalError instanceof Error ? originalError.message : String(originalError);
    throw new Error(`Failed to load OpenAPI/Knife4j doc: ${reason}`);
  }

  return browserCollected;
}

function tryParseSpecText(value: string): OpenApiSpec | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as OpenApiSpec;
    return isOpenApiSpec(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isOpenApiSpec(value: OpenApiSpec | null | undefined): value is OpenApiSpec {
  return Boolean(
    value && typeof value === 'object' && (value.openapi || value.swagger) && value.paths,
  );
}

function looksLikeHtml(contentType: string, body: string): boolean {
  return (
    /text\/html|application\/xhtml\+xml/i.test(contentType) || /<html[\s>]|swagger-ui/i.test(body)
  );
}

async function resolveSpecUrlFromSwaggerUi(pageUrl: string, html: string): Promise<string> {
  const directConfig = extractSwaggerConfig(html);
  if (directConfig) {
    return await resolveSpecUrlFromConfig(pageUrl, directConfig);
  }

  const initializerUrl = extractSwaggerInitializerUrl(pageUrl, html);
  if (!initializerUrl) {
    throw new Error(`Unable to find Swagger UI config from page: ${pageUrl}`);
  }

  const response = await fetch(initializerUrl, {
    headers: {
      Accept: 'application/javascript, text/javascript, */*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(
      `Swagger initializer request failed with HTTP ${response.status}: ${initializerUrl}`,
    );
  }

  const initializer = await response.text();
  const config = extractSwaggerConfig(initializer);
  if (!config) {
    throw new Error(`Unable to parse Swagger UI initializer config: ${initializerUrl}`);
  }

  return await resolveSpecUrlFromConfig(initializerUrl, config);
}

async function resolveSpecUrlFromDocPage(pageUrl: string, html: string): Promise<string> {
  if (isKnife4jDocPage(pageUrl)) {
    const knife4jUrl = await resolveSpecUrlFromKnife4j(pageUrl, html);
    if (knife4jUrl) {
      return knife4jUrl;
    }
  }

  return await resolveSpecUrlFromSwaggerUi(pageUrl, html);
}

async function tryCollectKnife4jViaBrowser(url: string): Promise<OpenApiCollected | null> {
  const browserCollector = await getKnife4jBrowserCollector();
  if (!browserCollector) {
    return null;
  }

  try {
    return await browserCollector(url);
  } catch {
    return null;
  }
}

async function getKnife4jBrowserCollector(): Promise<
  null | ((url: string) => Promise<OpenApiCollected>)
> {
  try {
    const browserModule = await import('../browser-fallback.js');
    if (typeof browserModule.collectKnife4jDocWithBrowser !== 'function') {
      return null;
    }

    return browserModule.collectKnife4jDocWithBrowser as (url: string) => Promise<OpenApiCollected>;
  } catch {
    return null;
  }
}

function isKnife4jDocPage(pageUrl: string): boolean {
  try {
    return new URL(pageUrl).pathname.toLowerCase().endsWith('/doc.html');
  } catch {
    return false;
  }
}

async function resolveSpecUrlFromKnife4j(pageUrl: string, html: string): Promise<string | null> {
  const discovered = extractKnife4jConfigUrl(pageUrl, html);
  const candidates = uniqueUrls([discovered, ...buildKnife4jSpecCandidates(pageUrl)]);

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      const response = await fetch(candidate, {
        headers: {
          Accept: 'application/json, */*;q=0.8',
        },
      });

      if (!response.ok) {
        continue;
      }

      const text = await response.text();
      if (tryParseSpecText(text)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractSwaggerInitializerUrl(pageUrl: string, html: string): string | null {
  const match = html.match(
    /<script\b[^>]*\bsrc=["']([^"']*swagger[-_]initializer[^"']*\.js[^"']*)["'][^>]*>/i,
  );
  return match?.[1] ? new URL(match[1], pageUrl).toString() : null;
}

function extractKnife4jConfigUrl(pageUrl: string, html: string): string {
  const directUrl =
    extractQuotedValue(html, 'url') ||
    extractQuotedValue(html, 'apiDocsUrl') ||
    extractQuotedValue(html, 'openApiUrl');
  return directUrl ? new URL(directUrl, pageUrl).toString() : '';
}

function extractSwaggerConfig(content: string): { url?: string; configUrl?: string } | null {
  const configUrl = extractQuotedValue(content, 'configUrl');
  const directUrl = extractQuotedValue(content, 'url');
  if (!configUrl && !directUrl) {
    return null;
  }

  return {
    url: directUrl,
    configUrl,
  };
}

async function resolveSpecUrlFromConfig(
  baseUrl: string,
  config: { url?: string; configUrl?: string },
): Promise<string> {
  if (config.url) {
    return new URL(config.url, baseUrl).toString();
  }

  if (!config.configUrl) {
    throw new Error(`Swagger UI config did not provide a spec url: ${baseUrl}`);
  }

  const configUrl = new URL(config.configUrl, baseUrl).toString();
  const response = await fetch(configUrl, {
    headers: {
      Accept: 'application/json, */*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Swagger config request failed with HTTP ${response.status}: ${configUrl}`);
  }

  const result = (await response.json()) as { url?: string; urls?: Array<{ url?: string }> };
  const specUrl = result.url || result.urls?.find((item) => item.url)?.url;
  if (!specUrl) {
    throw new Error(`Swagger config did not contain a spec url: ${configUrl}`);
  }

  return new URL(specUrl, configUrl).toString();
}

function extractQuotedValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`\\b${escaped}\\s*:\\s*["']([^"'\\n]+)["']`, 'i'));
  return match?.[1]?.trim() || '';
}

function buildKnife4jSpecCandidates(pageUrl: string): string[] {
  const parsed = new URL(pageUrl);
  const pathname = parsed.pathname;
  const docPath = pathname.replace(/\/doc\.html$/i, '/');
  const baseCandidates = new Set<string>([
    new URL('v2/api-docs', parsed.origin + '/').toString(),
    new URL('v3/api-docs', parsed.origin + '/').toString(),
    new URL('api/v2/api-docs', parsed.origin + '/').toString(),
    new URL('api/v3/api-docs', parsed.origin + '/').toString(),
  ]);

  if (docPath !== pathname) {
    const docBase = new URL(docPath.replace(/^\//, ''), parsed.origin + '/');
    baseCandidates.add(new URL('v2/api-docs', docBase).toString());
    baseCandidates.add(new URL('v3/api-docs', docBase).toString());
  }

  return Array.from(baseCandidates);
}

function extractOperations(spec: OpenApiSpec): OpenApiCollectedOperation[] {
  const operations: OpenApiCollectedOperation[] = [];

  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== 'object') {
      continue;
    }

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') {
        continue;
      }

      operations.push(buildCollectedOperation(spec, method.toUpperCase(), path, operation));
    }
  }

  return operations;
}

function buildCollectedOperation(
  spec: OpenApiSpec,
  method: string,
  path: string,
  operation: OpenApiOperation,
): OpenApiCollectedOperation {
  const parameters = resolveParameterList(spec, operation.parameters);
  const reqQuery = parameters
    .filter((item) => item.in === 'query')
    .map((item) => ({
      name: item.name,
      desc: item.description,
      required: item.required ? '1' : '0',
    }));
  const reqParams = parameters
    .filter((item) => item.in === 'path')
    .map((item) => ({
      name: item.name,
      desc: item.description,
      required: item.required ? '1' : '0',
    }));
  const reqHeaders = [
    ...parameters
      .filter((item) => item.in === 'header')
      .map((item) => ({ name: item.name, value: '', required: item.required ? '1' : '0' })),
    ...buildContentTypeHeaders(operation),
  ];
  const requestBody = resolveRequestBody(spec, operation.requestBody);
  const responseBody = resolveResponseBody(spec, operation.responses);
  const title = operation.summary?.trim() || operation.operationId?.trim() || `${method} ${path}`;

  return {
    title,
    method,
    path,
    desc: [operation.summary, operation.description].filter(Boolean).join('；'),
    reqBodyType: inferRequestBodyType(requestBody),
    requestBody,
    responseBody,
    reqHeaders: uniqueHeaderItems(reqHeaders),
    reqQuery,
    reqParams,
    operationId: operation.operationId?.trim() || '',
  };
}

function resolveParameterList(
  spec: OpenApiSpec,
  parameters: unknown[] | undefined,
): Array<{
  name: string;
  in: string;
  description?: string;
  required?: boolean;
}> {
  const items = Array.isArray(parameters) ? parameters : [];
  const resolved: Array<{ name: string; in: string; description?: string; required?: boolean }> =
    [];

  for (const item of items) {
    const parameter = dereference(spec, item);
    if (!parameter || typeof parameter !== 'object' || Array.isArray(parameter)) {
      continue;
    }

    const parameterRecord = asRecord(parameter);
    const name = getString(parameterRecord.name);
    const location = getString(parameterRecord.in);
    if (!name || !location) {
      continue;
    }

    resolved.push({
      name,
      in: location,
      description: getString(parameterRecord.description),
      required: Boolean(parameterRecord.required),
    });
  }

  return resolved;
}

function resolveRequestBody(spec: OpenApiSpec, requestBody: unknown): unknown {
  const resolved = dereference(spec, requestBody);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    return null;
  }

  const resolvedRecord = asRecord(resolved);
  const content = asRecord(resolvedRecord.content);
  const firstContent = Object.values(content)[0];
  if (firstContent && typeof firstContent === 'object' && !Array.isArray(firstContent)) {
    return normalizeSchema(spec, asRecord(firstContent).schema);
  }

  const schema = resolvedRecord.schema;
  if (schema) {
    return normalizeSchema(spec, schema);
  }

  return null;
}

function resolveResponseBody(
  spec: OpenApiSpec,
  responses: Record<string, unknown> | undefined,
): unknown {
  const candidates = ['200', '201', 'default'];
  for (const status of candidates) {
    const response = dereference(spec, responses?.[status]);
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      continue;
    }

    const responseRecord = asRecord(response);
    const content = asRecord(responseRecord.content);
    const firstContent = Object.values(content)[0];
    if (firstContent && typeof firstContent === 'object' && !Array.isArray(firstContent)) {
      return normalizeSchema(spec, asRecord(firstContent).schema);
    }

    const schema = responseRecord.schema;
    if (schema) {
      return normalizeSchema(spec, schema);
    }
  }

  return null;
}

function buildContentTypeHeaders(
  operation: OpenApiOperation,
): Array<{ name: string; value: string; required?: string }> {
  const consumes = Array.isArray(operation.consumes) ? operation.consumes.filter(Boolean) : [];
  return consumes.length ? [{ name: 'Content-Type', value: consumes[0], required: '1' }] : [];
}

function inferRequestBodyType(requestBody: unknown): string {
  if (!requestBody) {
    return '';
  }

  return 'json';
}

function normalizeSchema(spec: OpenApiSpec, schema: unknown): unknown {
  const resolved = dereference(spec, schema);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    return resolved ?? null;
  }

  const record = asRecord(resolved);
  const properties = asRecord(record.properties);
  const items = record.items ? normalizeSchema(spec, record.items) : undefined;

  return {
    ...record,
    ...(Object.keys(properties).length
      ? {
          properties: Object.fromEntries(
            Object.entries(properties).map(([key, value]) => [key, normalizeSchema(spec, value)]),
          ),
        }
      : {}),
    ...(items !== undefined ? { items } : {}),
  };
}

function dereference(spec: OpenApiSpec, value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const ref = getString(record.$ref);
  if (!ref) {
    return value;
  }

  return resolveRef(spec, ref);
}

function resolveRef(spec: OpenApiSpec, ref: string): unknown {
  if (!ref.startsWith('#/')) {
    return null;
  }

  const segments = ref
    .slice(2)
    .split('/')
    .map((item) => item.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current: unknown = spec;

  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return null;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current ?? null;
}

function uniqueHeaderItems(items: Array<{ name: string; value: string; required?: string }>) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.name}:${item.value}:${item.required || ''}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function uniqueUrls(items: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items) {
    const value = typeof item === 'string' ? item.trim() : '';
    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
