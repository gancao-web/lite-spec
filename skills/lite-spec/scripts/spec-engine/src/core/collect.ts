import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDraftContext, type IntakeContext } from './context.js';
import { getPlanOutDir } from './paths.js';
import { detectProjectProfile } from './project-profile.js';
import { collectRequirementFacts } from './requirement-scope.js';
import {
  getCredentialsPath,
  getLiteSpecCacheDir,
  getLiteSpecHome,
  readStoredCredentials,
  updateStoredCredentials,
} from './runtime-home.js';
import {
  collectYApiInterface,
  getYApiAuthFromEnv,
  isCompleteYApiAuth,
  parseYApiInterfaceId,
  YApiAuthError,
} from '../connectors/yapi.js';
import {
  collectFigmaFile,
  downloadFigmaThumbnail,
  FigmaAuthError,
  getFigmaTokenFromEnv,
  isFigmaUrl,
} from '../connectors/figma.js';
import { collectOpenApiDoc, isOpenApiUrl } from '../connectors/openapi.js';
import { collectReflectionDoc, isReflectionUrl } from '../connectors/reflection.js';
import { collectAxurePrototype, isAxureUrl } from '../connectors/axure.js';
import { capturePagePreviewSequenceWithBrowser } from '../browser-fallback.js';

export type CollectOptions = {
  repo?: string;
  prototype?: string[];
  figma?: string[];
  api?: string[];
  scope?: string;
  slug?: string;
  outDir?: string;
  yapiUid?: string;
  yapiToken?: string;
  figmaToken?: string;
};

type SourceItem = IntakeContext['sources'][number];
const PREVIEW_CACHE_TTL_MS = 48 * 60 * 60 * 1000;

export async function runCollect(options: CollectOptions): Promise<{
  outDir: string;
  context: IntakeContext;
}> {
  await cleanupPreviewCache();

  const outDir = getPlanOutDir({
    repo: options.repo,
    scope: options.scope,
    slug: options.slug,
    outDir: options.outDir,
  });

  const draft = createDraftContext({
    repo: options.repo,
    scope: options.scope,
    prototypeUrls: options.prototype ?? [],
    figmaUrls: options.figma ?? [],
    apiUrls: options.api ?? [],
  });
  draft.projectProfile = await detectProjectProfile(options.repo);

  const storedCredentials = await readStoredCredentials();
  const runtimeYApiAuth = storedCredentials.yapi;
  const runtimeFigmaAuth = storedCredentials.figma;
  const auth = isCompleteYApiAuth(
    options.yapiUid && options.yapiToken
      ? { uid: options.yapiUid, token: options.yapiToken }
      : null,
  )
    ? { uid: options.yapiUid!, token: options.yapiToken! }
    : isCompleteYApiAuth(runtimeYApiAuth)
    ? { uid: runtimeYApiAuth.uid, token: runtimeYApiAuth.token }
    : getYApiAuthFromEnv();
  const figmaToken =
    options.figmaToken?.trim() || runtimeFigmaAuth?.token?.trim() || getFigmaTokenFromEnv();

  if (options.yapiUid && options.yapiToken) {
    await updateStoredCredentials((current) => ({
      ...current,
      yapi: {
        uid: options.yapiUid!,
        token: options.yapiToken!,
        updatedAt: new Date().toISOString(),
      },
    }));
  } else if (hasCompleteRuntimeAuth(auth) && !isSameYApiAuth(runtimeYApiAuth, auth)) {
    await updateStoredCredentials((current) => ({
      ...current,
      yapi: {
        uid: auth.uid,
        token: auth.token,
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  if (options.figmaToken?.trim()) {
    await updateStoredCredentials((current) => ({
      ...current,
      figma: {
        token: options.figmaToken!.trim(),
        updatedAt: new Date().toISOString(),
      },
    }));
  } else if (figmaToken && runtimeFigmaAuth?.token !== figmaToken) {
    await updateStoredCredentials((current) => ({
      ...current,
      figma: {
        token: figmaToken,
        updatedAt: new Date().toISOString(),
      },
    }));
  }

  const hasYApiSource = draft.sources.some(
    (source: SourceItem) => source.type === 'api' && parseYApiInterfaceId(source.url),
  );
  const hasFigmaSource = draft.sources.some((source: SourceItem) => source.type === 'figma');

  if (hasYApiSource && !auth) {
    throw new Error(
      `Missing YApi auth. Provide YAPI_UID/YAPI_TOKEN once and they will be stored at ${getCredentialsPath()} for reuse. Runtime home: ${getLiteSpecHome()}`,
    );
  }

  if (hasFigmaSource && !figmaToken) {
    throw new FigmaAuthError(
      [
        'Missing Figma auth. Provide FIGMA_TOKEN once and it will be stored for reuse.',
        'Generate it in Figma: Settings -> Security -> Personal access tokens, with at least file_content:read permission.',
        'If you cannot provide a token right now, provide design screenshots or a page structure description instead.',
        'No final plan/tasks will be generated until one of these inputs is available.',
        `Credentials file: ${getCredentialsPath()}`,
        `Runtime home: ${getLiteSpecHome()}`,
      ].join(' '),
    );
  }

  for (const source of draft.sources) {
    try {
      if (source.type === 'prototype') {
        if (!isAxureUrl(source.url)) {
          source.summary = '当前仅自动采集 Axure 原型链接，其他原型链接需人工补充';
          continue;
        }

        const collected = await collectAxurePrototype(source.url);
        const previewResult = shouldCaptureAxurePreview(collected)
          ? await saveAxurePreview(collected)
          : null;
        source.status = 'collected';
        source.title = collected.title;
        source.summary = collected.summary;
        source.rawRef = previewResult?.relativePath || '';
        source.structured = {
          originalUrl: collected.originalUrl,
          resolvedPageUrl: collected.resolvedPageUrl,
          prototypeBaseUrl: collected.prototypeBaseUrl,
          pageId: collected.pageId,
          pageName: collected.pageName,
          pageFile: collected.pageFile,
          resolutionMethod: collected.resolutionMethod,
          pageTitle: collected.pageTitle,
          projectName: collected.projectName,
          ogImageUrl: collected.ogImageUrl,
          extractedTexts: collected.extractedTexts,
          previewImage: collected.previewImage,
          localPreviewPath: previewResult?.relativePath || '',
          localPreviewPaths: previewResult?.relativePaths || [],
          previewSource: previewResult ? 'browser-jpeg' : collected.previewImage.source,
          pageStructure: collected.pageStructure,
          imageAssets: collected.imageAssets,
          images: collected.images,
          raw: collected.raw,
        };

        const scopedFacts = collectRequirementFacts(
          collected.extractedTexts,
          draft.projectProfile.type,
        );
        draft.scopedRequirementFacts.push(...scopedFacts);
        draft.frontendScope.push(`原型页面：${collected.title}`);
        draft.frontendScope.push(`当前项目类型：${draft.projectProfile.type}`);
        draft.uiConstraints.push(
          `Axure 页面通过 ${collected.resolutionMethod} 方式解析，需以页面 ${
            collected.pageName || collected.pageTitle || collected.title
          } 为主依据`,
        );
        if (collected.pageStructure.actions.length) {
          draft.frontendScope.push(
            `原型操作项：${collected.pageStructure.actions.slice(0, 6).join('、')}`,
          );
        }
        if (collected.pageStructure.tableColumns.length) {
          draft.frontendScope.push(
            `原型表格列：${collected.pageStructure.tableColumns.slice(0, 8).join('、')}`,
          );
        }
        if (collected.pageStructure.fieldLabels.length) {
          draft.uiConstraints.push(
            `原型字段标签：${collected.pageStructure.fieldLabels.slice(0, 8).join('、')}`,
          );
        }
        if (collected.imageAssets.length) {
          draft.uiConstraints.push(
            `原型包含 ${collected.imageAssets.length} 个图片资产；默认只保留图片结构，不做逐图识别`,
          );
        }
        if (collected.previewImage.url) {
          draft.uiConstraints.push(
            '原型存在可用于预览的截图或缩略图入口；若页面存在图片资产，应优先把可清晰阅读的最终渲染图交给 AI 直接阅读，而不是逐张素材图识别',
          );
        }
        if (previewResult?.relativePath) {
          draft.uiConstraints.push(
            `原型页面预览图已保存到 ${previewResult.relativePath}，截图宽高按渲染后的 scrollWidth / scrollHeight 自动适配，可直接用于 AI 读图`,
          );
        }
        if (previewResult && previewResult.relativePaths.length > 1) {
          draft.uiConstraints.push(
            `原型页面较长，已自动拆分为 ${previewResult.relativePaths.length} 张连续预览图供 AI 顺序阅读`,
          );
        }
        if (draft.projectProfile.signals.length) {
          draft.uiConstraints.push(`项目识别信号：${draft.projectProfile.signals.join('、')}`);
        }
        draft.acceptanceCriteria.push(
          `原型页面 ${collected.title} 中的关键文案、流程入口和状态提示需要纳入需求审查`,
        );
        if (collected.pageStructure.annotations.length) {
          draft.acceptanceCriteria.push(
            `原型说明与注释需要纳入需求审查：${collected.pageStructure.annotations
              .slice(0, 3)
              .join('；')}`,
          );
        }
        if (scopedFacts.length) {
          draft.openQuestions.push(
            `提取出的需求 ${scopedFacts
              .slice(0, 5)
              .map((item) => item.text)
              .join('；')} 是否都在当前需求范围内`,
          );
        }
        if (!draft.businessGoal) {
          draft.businessGoal = collected.pageName || collected.pageTitle || collected.title;
        }
        continue;
      }

      if (source.type === 'figma') {
        if (!isFigmaUrl(source.url)) {
          continue;
        }

        const collected = await collectFigmaFile(source.url, figmaToken);
        const previewResult = await saveFigmaPreview(collected);
        source.status = 'collected';
        source.title = collected.title;
        source.summary = collected.summary || collected.fileKey;
        source.rawRef = previewResult?.relativePath || '';
        source.structured = {
          fileKey: collected.fileKey,
          nodeId: collected.nodeId,
          folderName: collected.folderName,
          pageName: collected.pageName,
          nodeName: collected.nodeName,
          thumbnailUrl: collected.thumbnailUrl,
          embedUrl: collected.embedUrl,
          previewSource: collected.previewSource,
          localPreviewPath: previewResult?.relativePath || '',
          raw: collected.raw,
        };

        draft.frontendScope.push(
          `设计稿页面：${collected.nodeName || collected.title}${
            collected.pageName ? `（${collected.pageName}）` : ''
          }`,
        );
        draft.uiConstraints.push(
          `设计稿 ${collected.title} 已可访问，需以 node ${
            collected.nodeId || '未指定'
          } 为主要对齐对象`,
        );
        if (collected.previewSource === 'figma-api') {
          draft.uiConstraints.push(
            `已通过 Figma API 获取 node ${collected.nodeId} 的真实预览图，可直接参考当前页面视觉实现`,
          );
        }
        if (previewResult?.relativePath) {
          draft.uiConstraints.push(
            `设计稿预览图已保存到 ${previewResult.relativePath}，可直接用于页面实现和视觉核对`,
          );
        }
        draft.acceptanceCriteria.push(
          `设计稿页面 ${
            collected.nodeName || collected.title
          } 的主要布局、模块顺序和核心视觉需纳入需求审查`,
        );
        if (!draft.businessGoal) {
          draft.businessGoal = collected.nodeName || collected.title;
        }
        continue;
      }

      if (source.type !== 'api') continue;

      let collected:
        | Awaited<ReturnType<typeof collectYApiInterface>>
        | Awaited<ReturnType<typeof collectOpenApiDoc>>
        | Awaited<ReturnType<typeof collectReflectionDoc>>
        | null = null;

      if (parseYApiInterfaceId(source.url)) {
        collected = await collectYApiInterface(source.url, auth!);
      } else if (isOpenApiUrl(source.url)) {
        collected = await collectOpenApiDoc(source.url);
      } else if (isReflectionUrl(source.url)) {
        collected = await collectReflectionDoc(source.url);
      } else {
        continue;
      }

      source.status = 'collected';
      source.title = collected.title;
      source.summary = `${collected.method} ${collected.path}`;
      source.structured = {
        interfaceId: 'interfaceId' in collected ? collected.interfaceId : undefined,
        sourceType: 'sourceType' in collected ? collected.sourceType : undefined,
        specTitle: 'specTitle' in collected ? collected.specTitle : undefined,
        specVersion: 'specVersion' in collected ? collected.specVersion : undefined,
        specUrl: 'specUrl' in collected ? collected.specUrl : undefined,
        operations: 'operations' in collected ? collected.operations : undefined,
        operationId: 'operationId' in collected ? collected.operationId : undefined,
        method: collected.method,
        path: collected.path,
        desc: collected.desc,
        reqBodyType: collected.reqBodyType,
        requestBody: collected.requestBody,
        responseBody: collected.responseBody,
        reqHeaders: collected.reqHeaders,
        reqQuery: collected.reqQuery,
        reqParams: collected.reqParams,
        raw: 'raw' in collected ? collected.raw : undefined,
      };

      if ('operations' in collected) {
        draft.apiDependencies.push(
          ...collected.operations.map((operation) => `${operation.method} ${operation.path}`),
        );
        draft.acceptanceCriteria.push(
          `OpenAPI 文档 ${collected.specTitle} 的主要接口、请求参数和返回结构已提取`,
        );
      } else {
        draft.apiDependencies.push(`${collected.method} ${collected.path}`);
        draft.acceptanceCriteria.push(
          `接口 ${collected.title} 的触发方式、请求参数和返回处理已明确`,
        );
      }

      if (!draft.businessGoal) {
        draft.businessGoal = collected.desc || collected.title;
      }
    } catch (error) {
      if (error instanceof YApiAuthError) {
        throw new YApiAuthError(
          `${
            error.message
          } If you are using stored credentials, update them and rerun. Credentials file: ${getCredentialsPath()}`,
        );
      }
      if (error instanceof FigmaAuthError) {
        throw new FigmaAuthError(
          `${
            error.message
          } If you are using stored credentials, update them and rerun. Credentials file: ${getCredentialsPath()}`,
        );
      }

      source.status = 'failed';
      source.summary = error instanceof Error ? error.message : String(error);
    }
  }

  return { outDir, context: draft };
}

function hasCompleteRuntimeAuth(
  value: { uid: string; token: string } | null | undefined,
): value is { uid: string; token: string } {
  return Boolean(value?.uid && value?.token);
}

function isSameYApiAuth(
  current: { uid: string; token: string } | undefined,
  next: { uid: string; token: string },
): boolean {
  return current?.uid === next.uid && current?.token === next.token;
}

async function saveFigmaPreview(
  collected: Awaited<ReturnType<typeof collectFigmaFile>>,
): Promise<{ relativePath: string } | null> {
  const preview = await downloadFigmaThumbnail(collected.thumbnailUrl);
  if (!preview) {
    return null;
  }

  const assetsDir = path.join(getLiteSpecCacheDir(), 'previews', 'figma');
  await mkdir(assetsDir, { recursive: true });

  const baseName = sanitizeFileName(
    `${collected.fileKey}${collected.nodeId ? `-${collected.nodeId}` : ''}`,
  );
  const fileName = `${baseName}.${preview.extension}`;
  const fullPath = path.join(assetsDir, fileName);

  await writeFile(fullPath, preview.bytes);

  return {
    relativePath: fullPath,
  };
}

async function saveAxurePreview(
  collected: Awaited<ReturnType<typeof collectAxurePrototype>>,
): Promise<{ relativePath: string; relativePaths: string[] } | null> {
  const assetsDir = path.join(getLiteSpecCacheDir(), 'previews', 'axure');
  await mkdir(assetsDir, { recursive: true });

  const baseName = sanitizeFileName(
    `${collected.pageName || collected.title || 'axure-preview'}-${collected.pageId || 'page'}`,
  );
  try {
    const fullPaths = await capturePagePreviewSequenceWithBrowser(
      collected.resolvedPageUrl,
      assetsDir,
      baseName,
      {
        width: collected.previewImage.suggestedWidth,
        height: collected.previewImage.suggestedHeight,
        quality: 80,
      },
    );
    const relativePaths = fullPaths.map((item) => path.resolve(item));
    if (!relativePaths.length) {
      return null;
    }

    return {
      relativePath: relativePaths[0],
      relativePaths,
    };
  } catch {
    return null;
  }
}

function shouldCaptureAxurePreview(
  collected: Awaited<ReturnType<typeof collectAxurePrototype>>,
): boolean {
  if (collected.imageAssets.length > 0) {
    return true;
  }

  const structure = collected.pageStructure;
  const hasEnoughStructuredText =
    collected.extractedTexts.length >= 3 ||
    structure.textBlocks.length > 0 ||
    structure.actions.length > 0 ||
    structure.fieldLabels.length >= 2 ||
    structure.tableColumns.length >= 2;

  return !hasEnoughStructuredText;
}

async function cleanupPreviewCache(now = Date.now()): Promise<void> {
  const previewRoot = path.join(getLiteSpecCacheDir(), 'previews');
  await removeExpiredEntries(previewRoot, now);
}

async function removeExpiredEntries(targetPath: string, now: number): Promise<boolean> {
  let entries;
  try {
    entries = await readdir(targetPath, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }

  let hasChildren = false;

  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      const childHasChildren = await removeExpiredEntries(fullPath, now);
      if (!childHasChildren) {
        await rm(fullPath, { recursive: true, force: true });
        continue;
      }
      hasChildren = true;
      continue;
    }

    const fileStat = await stat(fullPath);
    if (now - fileStat.mtimeMs > PREVIEW_CACHE_TTL_MS) {
      await rm(fullPath, { force: true });
      continue;
    }

    hasChildren = true;
  }

  return hasChildren;
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
