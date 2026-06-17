import path from 'node:path';
import type { IntakeContext } from './context.js';
import {
  buildQueryQuestionHints,
  buildResponseQuestionHints,
  buildResponseRiskHints,
  getResponseFields,
  type NamedItem,
  type RequirementMode,
} from './hint-rules.js';

export function renderPlan(context: IntakeContext): string {
  const analysis = analyzeContext(context);
  const integrationTitle =
    analysis.mode === 'frontend' ? '接口与数据依赖' : '系统依赖与影响面';
  const concernTitle = resolveConcernTitle(analysis.mode);

  return [
    '# 需求整理',
    '',
    '## 基本信息',
    '',
    `- 需求范围：${context.meta.scope || '未填写'}`,
    `- 目标项目：${formatRepoDisplay(context.meta.repo) || '未填写'}`,
    analysis.prototypePage ? `- 原型页面：${analysis.prototypePage}` : '',
    analysis.prototypeUrl ? `- 原型地址：${analysis.prototypeUrl}` : '',
    '',
    '## 需求目标',
    '',
    ...renderList(analysis.goalSummary),
    '',
    '## 功能需求整理',
    '',
    ...renderList(analysis.featureRequirements),
    '',
    '## 操作与流程',
    '',
    ...renderList(analysis.flowRequirements),
    '',
    `## ${resolveFieldSectionTitle(analysis.mode)}`,
    '',
    ...renderList(analysis.fieldRequirements),
    '',
    `## ${concernTitle}`,
    '',
    ...renderList(analysis.projectRecommendations),
    '',
    `## ${integrationTitle}`,
    '',
    ...renderList(analysis.integrationRequirements),
    '',
    '## 待确认项',
    '',
    ...renderList(analysis.openQuestions),
    '',
    '## 风险与边界',
    '',
    ...renderList(analysis.risks),
    '',
    '## 长期沉淀建议',
    '',
    ...renderList(analysis.docsSuggestions),
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function renderTasks(context: IntakeContext): string {
  const analysis = analyzeContext(context);
  type SourceItem = IntakeContext['sources'][number];

  return [
    '# 任务清单',
    '',
    '## 待审核任务',
    '',
    ...analysis.tasks.map((item) => `- [ ] ${item}`),
    '',
    '## 来源',
    '',
    ...context.sources.map(
      (source: SourceItem) => `- [${source.status}] ${source.type}: ${source.title || source.url}`,
    ),
    '',
  ].join('\n');
}

function analyzeContext(context: IntakeContext) {
  type SourceItem = IntakeContext['sources'][number];
  const primaryApiSource = context.sources.find(
    (item: SourceItem) => item.type === 'api' && item.structured,
  );
  const prototypeSource = context.sources.find(
    (item: SourceItem) => item.type === 'prototype' && item.structured,
  );
  const figmaSource = context.sources.find(
    (item: SourceItem) => item.type === 'figma' && item.structured,
  );
  const prototypeStructured = (prototypeSource?.structured ?? {}) as Record<string, unknown>;
  const figmaStructured = (figmaSource?.structured ?? {}) as Record<string, unknown>;
  const apiStructured = (primaryApiSource?.structured ?? {}) as Record<string, unknown>;
  const operations = asOperationItems(apiStructured.operations);
  const queryItems = asNamedItems(apiStructured.reqQuery);
  const paramItems = asNamedItems(apiStructured.reqParams);
  const requestBody = asObject(apiStructured.requestBody);
  const requestProps = asObject(requestBody.properties);
  const responseFields = getResponseFields(apiStructured.responseBody);
  const requestFields = Array.from(
    new Set(
      [
        ...queryItems.map((item) => item.name),
        ...paramItems.map((item) => item.name),
        ...Object.keys(requestProps),
      ].filter(Boolean),
    ),
  );

  const facts = asRequirementFacts(context.scopedRequirementFacts);
  const factTexts = facts.length
    ? facts.map((item) => item.text)
    : asStringArray(prototypeStructured.extractedTexts);
  const recommendedTexts = facts.filter((item) => item.recommended).map((item) => item.text);
  const normalizedFacts = uniqueList(factTexts.map(normalizeText).filter(Boolean));
  const grouped = groupFacts(normalizedFacts);
  const mode = resolveRequirementMode(context, grouped, operations, requestFields, responseFields);
  const queryQuestionHints = buildQueryQuestionHints(queryItems);
  const responseQuestionHints = buildResponseQuestionHints(responseFields, mode);

  const prototypePage =
    stringValue(prototypeSource?.title) || stringValue(prototypeStructured.pageName);
  const prototypeUrl =
    stringValue(prototypeStructured.resolvedPageUrl) || stringValue(prototypeSource?.url);
  const prototypePreviewPath = stringValue(prototypeStructured.localPreviewPath);
  const prototypePreviewPaths = asStringArray(prototypeStructured.localPreviewPaths);
  const figmaPage = stringValue(figmaStructured.nodeName) || stringValue(figmaSource?.title);
  const figmaPreviewPath = stringValue(figmaStructured.localPreviewPath);
  const figmaPreviewSource = stringValue(figmaStructured.previewSource);
  const businessGoal = context.businessGoal || prototypePage || context.meta.scope || '待补充';

  const goalSummary = uniqueList([
    businessGoal,
    figmaPage ? `设计稿当前参考页面：${figmaPage}` : '',
    ...grouped.background.slice(0, 2),
    ...grouped.goals.slice(0, 2),
  ]);

  const featureRequirements = uniqueList([
    mode === 'frontend' && figmaPage ? `需以设计稿页面 ${figmaPage} 为主要视觉依据` : '',
    ...grouped.titles.slice(0, 2),
    ...grouped.features,
    ...grouped.general.slice(0, 3),
  ]);

  const flowRequirements = uniqueList([...grouped.actions, ...grouped.results]);

  const fieldRequirements = uniqueList([...grouped.fields, ...requestFields, ...responseFields]);

  const projectRecommendations = uniqueList(
    mode === 'frontend'
      ? [
          prototypePreviewPath ? `可直接查看本地原型预览图：${prototypePreviewPath}` : '',
          prototypePreviewPaths.length > 1
            ? `原型预览图已自动拆分为 ${prototypePreviewPaths.length} 张，需按顺序阅读：${prototypePreviewPaths
                .slice(0, 5)
                .join('、')}${prototypePreviewPaths.length > 5 ? ' 等' : ''}`
            : '',
          figmaPreviewSource === 'figma-api'
            ? '已拿到设计稿真实页面预览图，优先按该页面核对模块布局与视觉细节'
            : '',
          figmaPreviewPath ? `可直接查看本地设计稿预览图：${figmaPreviewPath}` : '',
          ...recommendedTexts,
          ...grouped.actions.filter((item) => recommendedTexts.includes(item)),
          ...grouped.fields.filter((item) => recommendedTexts.includes(item)),
        ]
      : [
          ...recommendedTexts,
          ...grouped.actions.filter((item) => recommendedTexts.includes(item)),
          ...grouped.fields.filter((item) => recommendedTexts.includes(item)),
          context.projectProfile.signals.length
            ? `当前项目识别信号：${context.projectProfile.signals.join('、')}`
            : '',
        ],
  );

  const integrationRequirements = uniqueList([
    operations.length
      ? `当前资料中识别到 ${operations.length} 个接口，需确认哪些属于本次需求范围`
      : '',
    operations
      .slice(0, 5)
      .map((item) => `${item.method} ${item.path}`)
      .join('、'),
    requestFields.length
      ? `${mode === 'frontend' ? '请求相关字段' : '输入参数或请求字段'}：${requestFields.join('、')}`
      : '',
    responseFields.length
      ? `${mode === 'frontend' ? '返回或展示相关字段' : '返回字段或下游依赖字段'}：${responseFields.join('、')}`
      : '',
    grouped.results.some((item) => /导出|下载|上传|打印/.test(item))
      ? mode === 'frontend'
        ? '存在文件导出/下载/上传类需求，需确认界面交互、接口触发方式和结果反馈'
        : '存在文件导出/下载/上传类需求，需确认触发入口、权限控制、结果产物和失败处理'
      : '',
    mode !== 'frontend' && hasExecutionSignals(grouped)
      ? '需求包含任务、同步、重试或批处理特征，需确认调度方式、幂等要求和失败恢复策略'
      : '',
  ]);

  const openQuestions = uniqueList([
    featureRequirements.length
      ? `上述功能需求中，哪些明确属于本次要实现的范围，哪些只是原型中的预留或背景说明`
      : '',
    mode === 'frontend' && figmaPage
      ? `设计稿页面 ${figmaPage} 中哪些区域属于本次实现范围，哪些只是同文件中的其他模块或导航内容`
      : '',
    flowRequirements.length
      ? `关键操作 ${flowRequirements
          .slice(0, 4)
          .join('、')} 的触发条件、完成状态和异常反馈是否已经明确`
      : '',
    fieldRequirements.length
      ? resolveFieldQuestion(fieldRequirements, mode)
      : '',
    ...queryQuestionHints,
    ...responseQuestionHints,
  ]);

  const risks = uniqueList([
    featureRequirements.length
      ? mode === 'frontend'
        ? '原型中的需求点较多，若不先收敛本次实现范围，容易把背景信息或后续规划混入当前开发'
        : '需求点较多且来源分散，若不先收敛本次实现范围，容易把背景事项或后续规划混入当前交付'
      : '',
    mode === 'frontend' && figmaPreviewSource !== 'figma-api' && figmaSource
      ? '当前设计稿若只拿到公开缩略图而未拿到真实节点预览，可能导致页面细节判断不准确'
      : '',
    flowRequirements.length
      ? resolveFlowRisk(flowRequirements, mode)
      : '',
    fieldRequirements.length
      ? resolveFieldRisk(fieldRequirements, mode)
      : '',
    ...buildResponseRiskHints(responseFields, mode),
  ]);

  const docsSuggestions = buildDocsSuggestions({
    businessGoal,
    featureRequirements,
    flowRequirements,
    fieldRequirements,
    risks,
  });

  const tasks = uniqueList([
    goalSummary.length ? `确认需求目标与背景：${goalSummary.join('、')}` : '',
    mode === 'frontend' && figmaPage
      ? `核对设计稿页面 ${figmaPage} 的布局、模块顺序和核心视觉`
      : '',
    featureRequirements.length
      ? `拆解功能需求并确认范围：${featureRequirements.slice(0, 6).join('、')}`
      : '',
    flowRequirements.length ? `梳理关键操作链路：${flowRequirements.slice(0, 6).join('、')}` : '',
    fieldRequirements.length ? resolveFieldTask(fieldRequirements, mode) : '',
    integrationRequirements.length
      ? mode === 'frontend'
        ? '确认接口、数据依赖和外部协作边界'
        : '确认系统依赖、数据边界和外部协作边界'
      : '',
    projectRecommendations.length
      ? `结合当前项目优先确认推荐关注项：${projectRecommendations.slice(0, 6).join('、')}`
      : '',
    '整理待确认项并形成可审核的需求结论',
  ]);

  return {
    mode,
    prototypePage,
    prototypeUrl,
    goalSummary,
    featureRequirements,
    flowRequirements,
    fieldRequirements,
    projectRecommendations,
    integrationRequirements,
    openQuestions,
    risks,
    docsSuggestions,
    tasks,
  };
}

function formatRepoDisplay(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (path.isAbsolute(trimmed)) {
    return path.basename(trimmed.replace(/[\\/]+$/, '')) || '.';
  }

  return trimmed.replace(/\\/g, '/');
}

function groupFacts(texts: string[]) {
  const background = texts.filter((item) => /^背景[:：]/.test(item));
  const goals = texts.filter((item) => /^目标[:：]/.test(item));
  const titles = texts.filter((item) => isTitleLike(item));
  const actions = texts.filter((item) => isActionLike(item));
  const fields = texts.filter((item) => isFieldLike(item));
  const results = texts.filter((item) => isResultLike(item));
  const general = texts.filter(
    (item) =>
      !background.includes(item) &&
      !goals.includes(item) &&
      !titles.includes(item) &&
      !actions.includes(item) &&
      !fields.includes(item) &&
      !results.includes(item),
  );
  const features = uniqueList([
    ...titles,
    ...texts.filter((item) => /功能|需求|支持|提供|增加|新增|优化/.test(item)),
  ]);

  return {
    background,
    goals,
    titles,
    actions,
    fields,
    results,
    general,
    features,
  };
}

function normalizeText(value: string): string {
  return value
    .replace(/^[#\-*\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTitleLike(value: string): boolean {
  return value.length <= 30 && /页面|功能|需求|模块|服务|任务|作业|检测|管理|导出|提交|校验|同步|迁移/.test(value);
}

function isActionLike(value: string): boolean {
  return /点击|提交|导出|下载|上传|打印|删除|新增|编辑|修改|查询|搜索|筛选|联动|展示|保存|同步|支持|调度|执行|重试|回滚|迁移|发布/.test(
    value,
  );
}

function isFieldLike(value: string): boolean {
  return (
    value.length <= 20 &&
    /字段|列号|字段名|说明|编号|名称|时间|结果|状态|规格|重量|误差|操作人|备注|表|schema|配置|参数|队列|环境变量/.test(
      value,
    )
  );
}

function isResultLike(value: string): boolean {
  return /正常|异常|警告|成功|失败|提示|结果|展示|告警|重试|回滚|补偿/.test(value);
}

function asRequirementFacts(value: unknown): Array<{ text: string; recommended: boolean }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const text = (item as Record<string, unknown>).text;
    const recommended = (item as Record<string, unknown>).recommended;
    return typeof text === 'string' && typeof recommended === 'boolean' && text.trim()
      ? [{ text: text.trim(), recommended }]
      : [];
  });
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asNamedItems(value: unknown): NamedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const name = (item as Record<string, unknown>).name;
    return typeof name === 'string' && name.trim() ? [{ name: name.trim() }] : [];
  });
}

function asOperationItems(value: unknown): Array<{ method: string; path: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }

    const method = (item as Record<string, unknown>).method;
    const path = (item as Record<string, unknown>).path;
    return typeof method === 'string' && typeof path === 'string' && method.trim() && path.trim()
      ? [{ method: method.trim(), path: path.trim() }]
      : [];
  });
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDocsSuggestions(input: {
  businessGoal: string;
  featureRequirements: string[];
  flowRequirements: string[];
  fieldRequirements: string[];
  risks: string[];
}): string[] {
  const topic = sanitizeTopic(input.businessGoal || '本次需求');
  const combined = [
    input.businessGoal,
    ...input.featureRequirements,
    ...input.flowRequirements,
    ...input.fieldRequirements,
    ...input.risks,
  ].join(' ');

  const suggestions = uniqueList([
    '如确认形成长期知识，先按主真源判断沉淀位置：项目入口与使用方式写入 `README.md`，修改约束与验证要求写入 `AGENTS.md`，项目级规则写入 `docs/`，模块局部知识优先更新相关模块 `README.md`，Agent 本地流程或模板写入 `.agents/`。',
    /背景|上下文|历史|沿革|前情/.test(combined)
      ? `若本次沉淀的是业务背景、历史约束或长期前情，可考虑新增或更新 \`docs/context/${topic}.md\`。`
      : '',
    /规范|约定|口径|校验|兼容|边界|约束|字段|提交|commit|分支|评审|协作/.test(combined)
      ? `若本次沉淀的是项目级规则、字段口径或实现边界，可考虑新增或更新 \`docs/standards/${topic}.md\`。`
      : '',
    /发布|回滚|排障|故障|环境|联调|上线|巡检|操作步骤/.test(combined)
      ? `若本次沉淀的是发布、联调、排障或环境操作流程，可考虑新增或更新 \`docs/runbooks/${topic}.md\`。`
      : '',
    /架构|方案|决策|迁移|重构|取舍|废弃/.test(combined)
      ? `若本次沉淀的是长期架构决策、关键取舍或迁移原因，可考虑新增或更新 \`docs/adr/${topic}.md\`。`
      : '',
    '如本次仅为单次局部调整，没有形成长期规则，可明确写为“本次无建议沉淀的长期知识”。',
  ]);

  return suggestions;
}

function sanitizeTopic(value: string): string {
  const normalized = value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  return normalized || '本次需求';
}

function renderList(items: string[]): string[] {
  return items.length ? items.map((item) => `- ${item}`) : ['- 待补充'];
}

function uniqueList(items: string[]): string[] {
  return items.filter((item, index) => item && items.indexOf(item) === index);
}

function resolveRequirementMode(
  context: IntakeContext,
  grouped: ReturnType<typeof groupFacts>,
  operations: Array<{ method: string; path: string }>,
  requestFields: string[],
  responseFields: string[],
): RequirementMode {
  const profileType = context.projectProfile.type;
  if (profileType === 'frontend') {
    return 'frontend';
  }

  if (profileType === 'backend') {
    return 'service';
  }

  const joined = [
    context.meta.scope,
    context.businessGoal,
    ...grouped.features,
    ...grouped.actions,
    ...grouped.fields,
    ...grouped.results,
    ...requestFields,
    ...responseFields,
    ...operations.map((item) => `${item.method} ${item.path}`),
  ].join(' ');

  const frontendSignals =
    countMatches(
      joined,
      /页面|设计稿|原型|按钮|弹窗|抽屉|表单|列表|表格|筛选|搜索|展示|回显|交互|视觉|布局/i,
    ) + (context.sources.some((item) => item.type === 'figma' || item.type === 'prototype') ? 2 : 0);
  const serviceSignals = countMatches(
    joined,
    /接口|服务|任务|作业|调度|脚本|命令|批处理|日志|监控|告警|迁移|数据库|表|schema|队列|缓存|幂等|重试|回滚|部署|发布|同步/i,
  );

  if (frontendSignals >= serviceSignals + 2) {
    return 'frontend';
  }

  if (serviceSignals >= frontendSignals + 1) {
    return 'service';
  }

  if (profileType === 'fullstack' && context.sources.some((item) => item.type === 'figma' || item.type === 'prototype')) {
    return 'frontend';
  }

  return 'generic';
}

function resolveFieldSectionTitle(mode: RequirementMode): string {
  if (mode === 'frontend') {
    return '字段与展示项';
  }

  if (mode === 'service') {
    return '数据字段与处理约束';
  }

  return '关键字段与约束';
}

function resolveConcernTitle(mode: RequirementMode): string {
  if (mode === 'frontend') {
    return '结合当前项目的建议关注项';
  }

  if (mode === 'service') {
    return '结合当前项目的实施关注项';
  }

  return '结合当前项目的建议关注点';
}

function resolveFieldQuestion(fieldRequirements: string[], mode: RequirementMode): string {
  const preview = fieldRequirements.slice(0, 6).join('、');

  if (mode === 'frontend') {
    return `字段或展示项 ${preview} 的来源、展示规则和边界处理是否已经明确`;
  }

  if (mode === 'service') {
    return `字段、参数或数据项 ${preview} 的来源、写入规则、校验约束以及异常处理是否已经明确`;
  }

  return `关键字段、参数或约束项 ${preview} 的来源、使用规则和边界处理是否已经明确`;
}

function resolveFlowRisk(flowRequirements: string[], mode: RequirementMode): string {
  const preview = flowRequirements.slice(0, 4).join('、');

  if (mode === 'frontend') {
    return `关键操作 ${preview} 若缺少状态反馈、失败提示或权限判断，容易导致流程不可用`;
  }

  if (mode === 'service') {
    return `关键流程 ${preview} 若缺少状态流转、失败重试、幂等或权限控制，容易导致任务卡死、重复执行或结果不一致`;
  }

  return `关键流程 ${preview} 若缺少状态约束、失败处理或权限边界，容易导致执行结果不一致`;
}

function resolveFieldRisk(fieldRequirements: string[], mode: RequirementMode): string {
  const preview = fieldRequirements.slice(0, 6).join('、');

  if (mode === 'frontend') {
    return `字段或展示项 ${preview} 若与现有实现或接口返回不一致，容易导致界面展示或导出结果偏差`;
  }

  if (mode === 'service') {
    return `字段、参数或数据项 ${preview} 若与现有存储结构、接口契约或下游依赖不一致，容易导致数据错误、任务失败或兼容性问题`;
  }

  return `关键字段、参数或约束项 ${preview} 若与现有实现或依赖约定不一致，容易导致行为偏差或集成失败`;
}

function resolveFieldTask(fieldRequirements: string[], mode: RequirementMode): string {
  const preview = fieldRequirements.slice(0, 8).join('、');

  if (mode === 'frontend') {
    return `核对字段与展示项：${preview}`;
  }

  if (mode === 'service') {
    return `核对字段、参数与处理约束：${preview}`;
  }

  return `核对关键字段与约束项：${preview}`;
}

function hasExecutionSignals(grouped: ReturnType<typeof groupFacts>): boolean {
  return [...grouped.actions, ...grouped.results, ...grouped.general].some((item) =>
    /任务|作业|调度|同步|重试|回滚|补偿|批处理|发布|迁移|脚本|命令/.test(item),
  );
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
  return matches ? matches.length : 0;
}
