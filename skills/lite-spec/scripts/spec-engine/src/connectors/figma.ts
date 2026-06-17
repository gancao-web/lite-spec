export type FigmaCollected = {
  title: string;
  fileKey: string;
  nodeId: string;
  folderName: string;
  pageName: string;
  nodeName: string;
  thumbnailUrl: string;
  embedUrl: string;
  previewSource: 'oembed' | 'figma-api';
  summary: string;
  raw: Record<string, unknown>;
};

export class FigmaAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FigmaAuthError';
  }
}

type FigmaNode = {
  document?: {
    id?: string;
    name?: string;
    type?: string;
    children?: Array<{
      id?: string;
      name?: string;
      type?: string;
    }>;
  };
};

type FigmaNodesResponse = {
  nodes?: Record<string, FigmaNode | undefined>;
};

type FigmaImagesResponse = {
  err?: string | null;
  images?: Record<string, string | null | undefined>;
};

type FigmaOEmbedResponse = {
  title?: string;
  key?: string;
  url?: string;
  folder_name?: string;
  thumbnail_url?: string;
  html?: string;
  provider_name?: string;
  provider_url?: string;
  width?: number;
  height?: number;
};

export function getFigmaTokenFromEnv(): string {
  return process.env.FIGMA_TOKEN?.trim() || '';
}

export function isFigmaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('figma.com') && /\/(design|file)\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function parseFigmaInfo(url: string): {
  fileKey: string;
  nodeId: string;
} | null {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/(?:design|file)\/([^/]+)/);
    if (!match) return null;

    return {
      fileKey: match[1],
      nodeId: parsed.searchParams.get('node-id') ?? '',
    };
  } catch {
    return null;
  }
}

export async function collectFigmaPublicFile(url: string): Promise<FigmaCollected> {
  const parsed = parseFigmaInfo(url);
  if (!parsed) {
    throw new Error(`Unable to parse Figma file key from URL: ${url}`);
  }

  const oEmbedUrl = new URL('https://www.figma.com/api/oembed');
  oEmbedUrl.searchParams.set('url', url);

  const response = await fetch(oEmbedUrl);
  if (!response.ok) {
    throw new Error(`Figma oEmbed request failed with HTTP ${response.status}`);
  }

  const result = (await response.json()) as FigmaOEmbedResponse;
  const title = result.title?.trim() || '未命名设计稿';
  const folderName = result.folder_name?.trim() || '';
  const embedUrl = extractIframeSrc(result.html || '');
  const summaryParts = [folderName, parsed.nodeId ? `node ${parsed.nodeId}` : ''].filter(Boolean);

  return {
    title,
    fileKey: result.key || parsed.fileKey,
    nodeId: parsed.nodeId,
    folderName,
    pageName: '',
    nodeName: '',
    thumbnailUrl: result.thumbnail_url || '',
    embedUrl,
    previewSource: 'oembed',
    summary: summaryParts.join(' / '),
    raw: result as Record<string, unknown>,
  };
}

export async function collectFigmaFile(url: string, token?: string): Promise<FigmaCollected> {
  const publicCollected = await collectFigmaPublicFile(url);
  const authToken = token?.trim() || '';

  if (!authToken || !publicCollected.nodeId) {
    return publicCollected;
  }

  try {
    const apiCollected = await collectFigmaNodePreview(
      publicCollected.fileKey,
      publicCollected.nodeId,
      authToken,
    );
    const summaryParts = [
      publicCollected.folderName,
      apiCollected.pageName,
      apiCollected.nodeName || publicCollected.nodeId,
    ].filter(Boolean);

    return {
      ...publicCollected,
      title: apiCollected.nodeName || publicCollected.title,
      pageName: apiCollected.pageName,
      nodeName: apiCollected.nodeName,
      thumbnailUrl: apiCollected.thumbnailUrl || publicCollected.thumbnailUrl,
      previewSource: apiCollected.thumbnailUrl ? 'figma-api' : publicCollected.previewSource,
      summary: summaryParts.join(' / '),
      raw: {
        ...publicCollected.raw,
        figmaApi: apiCollected.raw,
      },
    };
  } catch (error) {
    if (error instanceof FigmaAuthError) {
      throw error;
    }

    return {
      ...publicCollected,
      raw: {
        ...publicCollected.raw,
        figmaApiError: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function collectFigmaNodePreview(
  fileKey: string,
  nodeId: string,
  token: string,
): Promise<{
  thumbnailUrl: string;
  pageName: string;
  nodeName: string;
  raw: Record<string, unknown>;
}> {
  const apiNodeId = normalizeFigmaNodeIdForApi(nodeId);
  const [nodeResult, imageResult] = await Promise.all([
    requestFigmaJson<FigmaNodesResponse>(
      `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(apiNodeId)}`,
      token,
    ),
    requestFigmaJson<FigmaImagesResponse>(
      `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(
        apiNodeId,
      )}&format=png&scale=2`,
      token,
    ),
  ]);

  const targetNode = nodeResult.nodes?.[apiNodeId]?.document;
  const imageUrl = imageResult.images?.[apiNodeId] || '';
  const pageName = resolveFigmaPageName(targetNode);
  const nodeName = targetNode?.name?.trim() || '';

  return {
    thumbnailUrl: imageUrl || '',
    pageName,
    nodeName,
    raw: {
      node: nodeResult.nodes?.[apiNodeId] || null,
      apiNodeId,
      imageUrl,
    },
  };
}

function normalizeFigmaNodeIdForApi(nodeId: string): string {
  return nodeId.replace(/-/g, ':');
}

async function requestFigmaJson<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'X-Figma-Token': token,
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new FigmaAuthError(
      'Figma token is invalid, expired, or lacks permission. Please refresh FIGMA_TOKEN and rerun.',
    );
  }

  if (!response.ok) {
    throw new Error(`Figma API request failed with HTTP ${response.status}: ${url}`);
  }

  return (await response.json()) as T;
}

function resolveFigmaPageName(node?: FigmaNode['document']): string {
  const canvasChild = node?.children?.find((item) => item?.type === 'CANVAS');
  return canvasChild?.name?.trim() || '';
}

export async function downloadFigmaThumbnail(
  thumbnailUrl: string,
): Promise<{ bytes: Uint8Array; extension: string } | null> {
  if (!thumbnailUrl) {
    return null;
  }

  const response = await fetch(thumbnailUrl);
  if (!response.ok) {
    throw new Error(`Figma thumbnail request failed with HTTP ${response.status}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') || '';

  return {
    bytes,
    extension: getImageExtension(contentType, thumbnailUrl),
  };
}

function extractIframeSrc(html: string): string {
  const match = html.match(/src="([^"]+)"/i);
  if (!match) return '';

  return decodeHtmlEntities(match[1]);
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#47;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function getImageExtension(contentType: string, url: string): string {
  if (contentType.includes('image/png')) return 'png';
  if (contentType.includes('image/jpeg')) return 'jpg';
  if (contentType.includes('image/webp')) return 'webp';

  const match = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  return match?.[1]?.toLowerCase() || 'img';
}
