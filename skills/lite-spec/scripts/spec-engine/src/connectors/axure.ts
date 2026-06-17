type AxureVariableValue = string | number | boolean | null;

export type AxureCollected = {
  title: string;
  summary: string;
  originalUrl: string;
  resolvedPageUrl: string;
  prototypeBaseUrl: string;
  pageId: string;
  pageName: string;
  pageFile: string;
  resolutionMethod: 'direct-html' | 'iframe-src' | 'document-sitemap-id';
  pageTitle: string;
  projectName: string;
  ogImageUrl: string;
  extractedTexts: string[];
  previewImage: AxurePreviewImage;
  pageStructure: AxurePageStructure;
  imageAssets: AxureImageAsset[];
  images: AxureImageInfo[];
  raw: Record<string, unknown>;
};

type AxureResolutionMethod = 'direct-html' | 'iframe-src' | 'document-sitemap-id';
export type AxurePageStructure = {
  titles: string[];
  textBlocks: string[];
  actions: string[];
  fieldLabels: string[];
  tableColumns: string[];
  annotations: string[];
  stats: {
    buttonCount: number;
    inputCount: number;
    tableCellTextCount: number;
    textBlockCount: number;
    imageAssetCount: number;
  };
};
export type AxureImageAsset = {
  widgetId: string;
  kind: 'img' | 'generated-svg';
  url: string;
};
export type AxureImageInfo = {
  widgetId: string;
  kind: 'img' | 'generated-svg';
  url: string;
  roleHints: string[];
  labelText: string;
  markerLabel: string;
  localTexts: string[];
  markers: Array<{
    label: string;
    roleHint?: string;
  }>;
};
export type AxurePreviewImage = {
  url: string;
  source: 'og-image' | 'none';
  suggestedWidth: number;
  suggestedHeight: number;
};
type AxureResolvedPage = {
  resolvedPageUrl: string;
  prototypeBaseUrl: string;
  pageId: string;
  pageName: string;
  pageFile: string;
  resolutionMethod: AxureResolutionMethod;
};

const AXURE_USER_AGENT = 'lite-spec-axure/0.1';

export function isAxureUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.hostname && /axure|axshare/i.test(parsed.hostname));
  } catch {
    return false;
  }
}

export async function collectAxurePrototype(url: string): Promise<AxureCollected> {
  const outerHtml = await getText(url);
  const resolved = await resolveAxureEntryUrl(url, outerHtml);
  const pageHtml = await getAxurePageHtml(resolved);
  const pageDataUrls = extractPageDataUrls(pageHtml, resolved.resolvedPageUrl);
  const pageDataTexts = await collectPageDataTexts(pageDataUrls);
  const htmlTexts = extractAxureVisibleTexts(pageHtml);
  const imageAssets = extractAxureImageAssets(pageHtml, resolved.resolvedPageUrl);
  const pageTitle =
    extractTitle(pageHtml) || extractMetaContent(pageHtml, 'og:title') || resolved.pageName;
  const projectName = extractProjectName(outerHtml) || extractProjectName(pageHtml);
  const ogTitle = extractMetaContent(outerHtml, 'og:title');
  const ogImageUrl = extractMetaContent(outerHtml, 'og:image');
  const extractedTexts = uniqueTexts([...htmlTexts, ...pageDataTexts]).slice(0, 40);
  const previewSize = await resolvePreviewViewportSize(resolved.resolvedPageUrl, pageHtml);
  const previewImage = buildAxurePreviewImage(ogImageUrl, previewSize);
  const images = await buildAxureImageInfos(pageHtml, imageAssets);
  const title = resolved.pageName || pageTitle || '未命名原型页面';
  const pageStructure = buildAxurePageStructure(pageHtml, extractedTexts, title, imageAssets);
  const summaryParts = [
    resolved.pageId ? `pageId ${resolved.pageId}` : '',
    resolved.resolutionMethod,
    resolved.pageFile || '',
    pageStructure.annotations[0] || extractedTexts[0] || '',
  ].filter(Boolean);

  return {
    title,
    summary: summaryParts.join(' / '),
    originalUrl: url,
    resolvedPageUrl: resolved.resolvedPageUrl,
    prototypeBaseUrl: resolved.prototypeBaseUrl,
    pageId: resolved.pageId,
    pageName: resolved.pageName,
    pageFile: resolved.pageFile,
    resolutionMethod: resolved.resolutionMethod,
    pageTitle,
    projectName,
    ogImageUrl,
    extractedTexts,
    previewImage,
    pageStructure,
    imageAssets,
    images,
    raw: {
      ogTitle,
      pageDataUrls,
    },
  };
}

async function resolveAxureEntryUrl(
  sourceUrl: string,
  sourceHtml?: string,
): Promise<AxureResolvedPage> {
  if (isHtmlPageUrl(sourceUrl)) {
    const entryState = getAxureEntryState(sourceUrl);
    return {
      resolvedPageUrl: sourceUrl,
      prototypeBaseUrl: getPrototypeBaseUrl(sourceUrl),
      pageId: entryState.pageId,
      pageName: entryState.pageName,
      pageFile: decodeURIComponent(pathBaseName(new URL(sourceUrl).pathname)),
      resolutionMethod: 'direct-html',
    };
  }

  const html = sourceHtml ?? (await getText(sourceUrl));
  const prototypeBaseUrl = getPrototypeBaseUrl(sourceUrl);
  const entryState = getAxureEntryState(sourceUrl);
  const iframeSrc = extractMainFrameSrc(html);

  if (iframeSrc && iframeSrc.toLowerCase() !== 'about:blank') {
    const resolvedPageUrl = resolveUrl(sourceUrl, iframeSrc);
    if (!isHtmlPageUrl(resolvedPageUrl)) {
      throw new Error(`Axure iframe did not resolve to an HTML page: ${resolvedPageUrl}`);
    }

    return {
      resolvedPageUrl,
      prototypeBaseUrl,
      pageId: entryState.pageId,
      pageName: entryState.pageName,
      pageFile: decodeURIComponent(pathBaseName(new URL(resolvedPageUrl).pathname)),
      resolutionMethod: 'iframe-src',
    };
  }

  const pageId = entryState.pageId;
  if (!pageId) {
    throw new Error('Axure player iframe is blank and source URL does not contain page id');
  }

  const documentUrl = resolveUrl(prototypeBaseUrl, 'data/document.js');
  const documentJs = await getText(documentUrl);
  const sitemapNode = findSitemapNodeById(documentJs, pageId);

  return {
    resolvedPageUrl: resolveUrl(prototypeBaseUrl, sitemapNode.url),
    prototypeBaseUrl,
    pageId,
    pageName: sitemapNode.pageName || entryState.pageName,
    pageFile: sitemapNode.url,
    resolutionMethod: 'document-sitemap-id',
  };
}

async function getAxurePageHtml(resolved: AxureResolvedPage): Promise<string> {
  const directHtml = await getText(resolved.resolvedPageUrl);
  const directTexts = extractAxureVisibleTexts(directHtml);
  if (directTexts.length >= 5) {
    return directHtml;
  }

  const browserHtml = await tryCollectAxurePageWithBrowser(resolved.resolvedPageUrl);
  if (browserHtml) {
    const browserTexts = extractAxureVisibleTexts(browserHtml);
    if (browserTexts.length > directTexts.length) {
      return browserHtml;
    }
  }

  return directHtml;
}

function getAxureEntryState(sourceUrl: string): { pageId: string; pageName: string } {
  const parsed = new URL(sourceUrl);
  const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));

  return {
    pageId: parsed.searchParams.get('id') || hashParams.get('id') || '',
    pageName: parsed.searchParams.get('p') || hashParams.get('p') || '',
  };
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': AXURE_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }

  return await response.text();
}

function isHtmlPageUrl(sourceUrl: string): boolean {
  return new URL(sourceUrl).pathname.toLowerCase().endsWith('.html');
}

function getPrototypeBaseUrl(sourceUrl: string): string {
  const parsedUrl = new URL(sourceUrl);
  const firstPathSegment = parsedUrl.pathname.split('/').filter(Boolean)[0];

  if (!firstPathSegment) {
    throw new Error(`Cannot derive Axure prototype base URL from ${sourceUrl}`);
  }

  return new URL(`/${firstPathSegment}/`, parsedUrl.origin).toString();
}

function extractMainFrameSrc(html: string): string {
  const iframeMatch = html.match(/<iframe\b[^>]*\bid=["']mainFrame["'][^>]*>/i);
  if (!iframeMatch) return '';

  const srcMatch = iframeMatch[0].match(/\bsrc=["']([^"']*)["']/i);
  return srcMatch ? srcMatch[1].trim() : '';
}

function resolveUrl(baseUrl: string, resourcePath: string): string {
  return new URL(resourcePath, baseUrl).toString();
}

function parseAxureVariableTable(documentJs: string): Map<string, AxureVariableValue> {
  const variableStart = documentJs.search(/\bvar\s+[A-Za-z_$][\w$]*\s*=/);
  if (variableStart < 0) {
    throw new Error('Failed to parse Axure document: variable table was not found');
  }

  const terminatorMatch = /;\s*return\s+_creator\(\);/.exec(documentJs.slice(variableStart));
  if (!terminatorMatch || typeof terminatorMatch.index !== 'number') {
    throw new Error('Failed to parse Axure document: variable table terminator was not found');
  }

  const variableEnd = variableStart + terminatorMatch.index;
  const variableText = documentJs.slice(variableStart, variableEnd).replace(/^\s*var\s+/, '');
  const values = new Map<string, AxureVariableValue>();
  const assignmentPattern =
    /([A-Za-z_$][\w$]*)\s*=\s*("(?:\\.|[^"\\])*"|0x[0-9a-fA-F]+|-?\d+(?:\.\d+)?|true|false|null)/g;

  for (const match of variableText.matchAll(assignmentPattern)) {
    const [, key, rawValue] = match;

    if (rawValue.startsWith('"')) {
      values.set(key, JSON.parse(rawValue));
      continue;
    }

    if (rawValue === 'true' || rawValue === 'false') {
      values.set(key, rawValue === 'true');
      continue;
    }

    if (rawValue === 'null') {
      values.set(key, null);
      continue;
    }

    values.set(key, Number(rawValue));
  }

  return values;
}

function findSitemapNodeById(
  documentJs: string,
  pageId: string,
): { id: string; pageName: string; url: string } {
  const values = parseAxureVariableTable(documentJs);
  const idToken = findTokenByStringValue(values, pageId);

  if (!idToken) {
    throw new Error(`Axure sitemap did not contain page id ${pageId}`);
  }

  const sitemapPattern = new RegExp(
    `_\\(v,${idToken},x,([A-Za-z_$][\\w$]*),z,([A-Za-z_$][\\w$]*),B,([A-Za-z_$][\\w$]*)`,
    'g',
  );
  const match = sitemapPattern.exec(documentJs);

  if (!match) {
    throw new Error(`Axure sitemap contained page id ${pageId}, but no page URL node was found`);
  }

  const [, pageNameToken, , pageUrlToken] = match;
  const pageName = getRequiredStringToken(values, pageNameToken);
  const url = getRequiredStringToken(values, pageUrlToken);

  return { id: pageId, pageName, url };
}

function findTokenByStringValue(
  values: Map<string, AxureVariableValue>,
  targetValue: string,
): string | null {
  for (const [token, value] of values.entries()) {
    if (value === targetValue) {
      return token;
    }
  }

  return null;
}

function getRequiredStringToken(values: Map<string, AxureVariableValue>, token: string): string {
  const value = values.get(token);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Failed to parse Axure document: token ${token} did not resolve to a string`);
  }

  return value;
}

function extractPageDataUrls(html: string, pageUrl: string): string[] {
  return uniqueTexts(
    Array.from(
      html.matchAll(/(?:src|href)=["']([^"']*files\/[^"']+\/data\.(?:js|json)(?:\?[^"']*)?)["']/gi),
      (match) => resolveUrl(pageUrl, match[1]),
    ),
  );
}

async function collectPageDataTexts(urls: string[]): Promise<string[]> {
  const texts: string[] = [];

  for (const url of urls) {
    try {
      const content = await getText(url);
      texts.push(...extractReadableTexts(content));
    } catch {
      continue;
    }
  }

  return texts;
}

async function resolvePreviewViewportSize(
  pageUrl: string,
  pageHtml: string,
): Promise<{ width: number; height: number }> {
  const direct = extractRenderedBodySize(pageHtml);
  if (direct) {
    return normalizePreviewViewportSize(direct);
  }

  const browserHtml = await tryCollectAxurePageWithBrowser(pageUrl);
  const browser = browserHtml ? extractRenderedBodySize(browserHtml) : null;
  return normalizePreviewViewportSize(browser);
}

function buildAxurePreviewImage(
  ogImageUrl: string,
  size: { width: number; height: number },
): AxurePreviewImage {
  if (!ogImageUrl) {
    return {
      url: '',
      source: 'none',
      suggestedWidth: size.width,
      suggestedHeight: size.height,
    };
  }

  return {
    url: ogImageUrl,
    source: 'og-image',
    suggestedWidth: size.width,
    suggestedHeight: size.height,
  };
}

function extractRenderedBodySize(html: string): { width: number; height: number } | null {
  const bodyTagMatch = html.match(/<body\b[^>]*style=["']([^"']+)["'][^>]*>/i);
  const bodyStyle = bodyTagMatch?.[1] || '';
  const baseMatch = html.match(/<div\b[^>]*id=["']base["'][^>]*style=["']([^"']+)["'][^>]*>/i);
  const baseStyle = baseMatch?.[1] || '';

  const width =
    extractPxFromStyle(bodyStyle, 'width') ||
    extractPxFromStyle(baseStyle, 'width') ||
    extractPxFromStyle(bodyStyle, 'max-width');
  const height =
    extractPxFromStyle(bodyStyle, 'height') ||
    extractPxFromStyle(baseStyle, 'height') ||
    extractPxFromStyle(html.match(/<div\b[^>]*id=["']mainPanel["'][^>]*style=["']([^"']+)["'][^>]*>/i)?.[1] || '', 'height');

  if (!width && !height) {
    return null;
  }

  return {
    width: width || 1440,
    height: height || 1400,
  };
}

function extractPxFromStyle(style: string, property: string): number {
  const match = style.match(new RegExp(`${property}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px`, 'i'));
  return match ? Math.round(Number(match[1])) : 0;
}

function normalizePreviewViewportSize(
  value: { width: number; height: number } | null,
): { width: number; height: number } {
  const width = clampInt(value?.width || 1440, 900, 3200);
  const height = clampInt(value?.height || 1400, 900, 2800);
  return { width, height };
}

async function tryCollectAxurePageWithBrowser(url: string): Promise<string | null> {
  try {
    const browserCollector = await getPageBrowserCollector();
    if (!browserCollector) {
      return null;
    }

    return await browserCollector(url);
  } catch {
    return null;
  }
}

async function getPageBrowserCollector(): Promise<null | ((url: string) => Promise<string>)> {
  try {
    const browserModule = await import('../browser-fallback.js');
    if (typeof browserModule.collectPageDomWithBrowser !== 'function') {
      return null;
    }

    return browserModule.collectPageDomWithBrowser as (url: string) => Promise<string>;
  } catch {
    return null;
  }
}

function extractAxureVisibleTexts(html: string): string[] {
  const textSegments = Array.from(
    html.matchAll(/<div\b[^>]*\bid=["'][^"']*_text["'][^>]*>([\s\S]*?)<\/div>/gi),
    (match) => normalizeVisibleTextBlock(match[1]),
  ).filter(Boolean);
  const inputValues = Array.from(
    html.matchAll(/<input\b[^>]*\bvalue=["']([^"']*)["'][^>]*>/gi),
    (match) => decodeHtmlEntities(match[1]),
  )
    .map((item) => item.trim())
    .filter(isMeaningfulText);

  const visibleTexts = uniqueTexts([...textSegments, ...inputValues]);
  return visibleTexts.length ? visibleTexts : extractReadableTexts(html);
}

function buildAxurePageStructure(
  html: string,
  extractedTexts: string[],
  pageTitle: string,
  imageAssets: AxureImageAsset[],
): AxurePageStructure {
  const widgets = extractTextWidgets(html);
  const buttonTexts = uniqueTexts(
    widgets
      .filter((item) => /\b(primary_button|button)\b/i.test(item.className))
      .map((item) => item.text)
      .filter(isMeaningfulText),
  );
  const tableColumns = uniqueTexts(
    widgets
      .filter((item) => /\btable_cell\b/i.test(item.className))
      .map((item) => item.text)
      .filter((item) => item.length <= 20 && isMeaningfulText(item)),
  );
  const textBlocks = uniqueTexts(
    extractedTexts.filter((item) => item.includes('\n') || item.length > 24),
  );
  const annotations = uniqueTexts(
    textBlocks.filter((item) => /(^|\n)\d+[、.．]|说明|描述|注意|支持|需|应|规则|要求/.test(item)),
  );
  const fieldLabels = uniqueTexts(
    widgets
      .filter((item) => /\blabel\b/i.test(item.className))
      .map((item) => item.text)
      .filter(
        (item) =>
          !buttonTexts.includes(item) &&
          !tableColumns.includes(item) &&
          !textBlocks.includes(item) &&
          item.length <= 20 &&
          isGenericFieldLike(item),
      ),
  );
  const titles = uniqueTexts(
    [
      pageTitle,
      ...widgets
        .filter((item) => /\blabel\b/i.test(item.className))
        .map((item) => item.text)
        .filter(
          (item) =>
            !buttonTexts.includes(item) &&
            !tableColumns.includes(item) &&
            !fieldLabels.includes(item) &&
            !textBlocks.includes(item) &&
            item.length <= 20 &&
            isMeaningfulText(item),
        ),
    ].filter(Boolean),
  );

  return {
    titles,
    textBlocks,
    actions: buttonTexts,
    fieldLabels,
    tableColumns,
    annotations,
    stats: {
      buttonCount: buttonTexts.length,
      inputCount: countMatches(html, /<input\b/gi),
      tableCellTextCount: tableColumns.length,
      textBlockCount: textBlocks.length,
      imageAssetCount: imageAssets.length,
    },
  };
}

function extractAxureImageAssets(html: string, pageUrl: string): AxureImageAsset[] {
  const imgAssets = Array.from(
    html.matchAll(
      /<img\b[^>]*id=["']([^"']+)_img["'][^>]*src=["']([^"']+)["'][^>]*>/gi,
    ),
    (match) => ({
      widgetId: match[1],
      kind: 'img' as const,
      url: resolveUrl(pageUrl, match[2]),
    }),
  );
  const generatedSvgAssets = Array.from(
    html.matchAll(
      /<svg\b[^>]*data=["']([^"']+)["'][^>]*id=["']([^"']+)_img["'][^>]*class=["'][^"']*generatedImage[^"']*["'][^>]*>/gi,
    ),
    (match) => ({
      widgetId: match[2],
      kind: 'generated-svg' as const,
      url: resolveUrl(pageUrl, match[1]),
    }),
  );

  const unique = new Set<string>();
  const assets: AxureImageAsset[] = [];
  for (const asset of [...imgAssets, ...generatedSvgAssets]) {
    const key = `${asset.kind}:${asset.widgetId}:${asset.url}`;
    if (unique.has(key)) {
      continue;
    }

    unique.add(key);
    assets.push(asset);
  }

  return assets;
}

async function buildAxureImageInfos(
  html: string,
  assets: AxureImageAsset[],
): Promise<AxureImageInfo[]> {
  const widgetTexts = new Map<string, string>();
  const widgetClasses = new Map<string, string>();
  const widgetPattern =
    /<div\b[^>]*id=["']([^"']+)["'][^>]*class=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi;

  for (const match of html.matchAll(widgetPattern)) {
    const widgetId = match[1]?.trim() || '';
    const className = match[2]?.trim() || '';
    const blockHtml = match[3] || '';
    if (!widgetId) {
      continue;
    }

    widgetClasses.set(widgetId, className);
    const textMatch = blockHtml.match(/<div\b[^>]*id=["'][^"']*_text["'][^>]*>([\s\S]*?)<\/div>/i);
    const text = normalizeVisibleTextBlock(textMatch?.[1] || '');
    if (text) {
      widgetTexts.set(widgetId, text);
    }
  }

  const infos: AxureImageInfo[] = [];
  for (const asset of assets) {
    const className = widgetClasses.get(asset.widgetId) || '';
    const labelText = widgetTexts.get(asset.widgetId) || '';
    const markerLabel = /\bmarker\b/i.test(className) ? labelText : '';
    const roleHints = inferImageRoleHints(asset, className, labelText);
    const localTexts = uniqueTexts(labelText ? splitReadableText(labelText) : []);
    infos.push({
      widgetId: asset.widgetId,
      kind: asset.kind,
      url: asset.url,
      roleHints,
      labelText,
      markerLabel,
      localTexts,
      markers: markerLabel
        ? [
            {
              label: markerLabel,
              roleHint: 'annotation-marker',
            },
          ]
        : [],
    });
  }

  return infos;
}

function inferImageRoleHints(
  asset: AxureImageAsset,
  className: string,
  labelText: string,
): string[] {
  const hints: string[] = [];

  if (/\bmarker\b/i.test(className)) {
    hints.push('annotation-marker');
  }
  if (/\bimage\b/i.test(className) || asset.kind === 'img') {
    hints.push('screenshot-or-illustration');
  }
  if (asset.kind === 'generated-svg') {
    hints.push('generated-overlay');
  }
  if (labelText && /^\d+$/.test(labelText.trim())) {
    hints.push('numbered-callout');
  }

  return uniqueTexts(hints);
}

function extractTextWidgets(html: string): Array<{ className: string; text: string }> {
  const widgets: Array<{ className: string; text: string }> = [];
  const pattern =
    /<div\b[^>]*class=["']([^"']+)["'][^>]*>[\s\S]*?<div\b[^>]*id=["'][^"']*_text["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;

  for (const match of html.matchAll(pattern)) {
    const className = match[1]?.trim() || '';
    const text = normalizeVisibleTextBlock(match[2] || '');
    if (!className || !text) {
      continue;
    }

    widgets.push({ className, text });
  }

  return widgets;
}

function normalizeVisibleTextBlock(value: string): string {
  const text = decodeHtmlEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\u00a0/g, ' '),
  );

  return splitReadableText(text)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter(isMeaningfulText)
    .join('\n')
    .trim();
}

function extractReadableTexts(content: string): string[] {
  const textFromHtml = content
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

  const literalTexts = Array.from(
    content.matchAll(/"((?:\\.|[^"\\]){2,120})"|'((?:\\.|[^'\\]){2,120})'/g),
    (match) => decodeEscapes(match[1] || match[2] || ''),
  );

  return uniqueTexts([...splitReadableText(textFromHtml), ...literalTexts]).filter(
    isMeaningfulText,
  );
}

function splitReadableText(value: string): string[] {
  return value
    .split(/[\r\n\t]+| {2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isMeaningfulText(value: string): boolean {
  if (value.length < 2 || value.length > 120) return false;
  if (/^(noindex, nofollow|application\/json\+oembed)$/i.test(value)) return false;
  if (/^(true|false|null|undefined)$/i.test(value)) return false;
  if (/^(https?:|data:|javascript:)/i.test(value)) return false;
  if (/^\$axure\b/i.test(value)) return false;
  if (/^return\s+_creator\(\);?$/i.test(value)) return false;
  if (/\.html?$/i.test(value)) return false;
  if (/\.css(\?|$)/i.test(value)) return false;
  if (/^[up]\d+[-_]/i.test(value) && !/[一-龥]/.test(value)) return false;
  if (/^(axure|inter|arial|normal|sans-serif|pingfang)/i.test(value)) return false;
  if (/^ax_default\b/i.test(value)) return false;
  if (/^display\s*:/i.test(value)) return false;
  if (/^created with axure rp$/i.test(value)) return false;
  if (/[{}[\]=<>]/.test(value) && !/[一-龥]/.test(value)) return false;
  if (/^[\w./:-]+$/.test(value) && !/[一-龥 ]/.test(value)) return false;
  if (!/[A-Za-z一-龥0-9]/.test(value)) return false;

  return true;
}

function isGenericFieldLike(value: string): boolean {
  return /(:|：)$|编号|名称|时间|日期|状态|类型|金额|数量|说明|ID|编码|手机号|手机|邮箱|地址|标签|分类|角色|部门|等级|开始|结束|范围|关键字|备注|结果/i.test(
    value,
  );
}

function decodeEscapes(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'");
}

function extractMetaContent(html: string, propertyName: string): string {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyPattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    'i',
  );
  const contentFirstPattern = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    'i',
  );

  return decodeHtmlEntities(
    propertyPattern.exec(html)?.[1] || contentFirstPattern.exec(html)?.[1] || '',
  );
}

function extractTitle(html: string): string {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match?.[1]?.trim() || '');
}

function extractProjectName(html: string): string {
  const match = html.match(/doc\.configuration\.projectName\s*=\s*['"]([^'"]+)['"]/i);
  return decodeEscapes(match?.[1] || '');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function uniqueTexts(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of items.map((item) => item.trim()).filter(Boolean)) {
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }

  return result;
}

function pathBaseName(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
