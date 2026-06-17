import type { ProjectType } from './project-profile.js';

export type RequirementFact = {
  text: string;
  recommended: boolean;
};

const CLEAR_NOISE_PATTERNS = [
  /^##?\s*\d+$/,
  /^\|\s*[A-Z0-9/%.() -]+\s*\|?$/,
  /^noindex,\s*nofollow$/i,
  /^files\/.+\.(?:css|js)$/i,
  /^images\/.+$/i,
  /generatedImage/i,
  /PingFang|Arial|sans-serif/i,
  /^ax_default\b/i,
];

const FRONTEND_RECOMMEND_PATTERNS = [
  /页面|弹窗|抽屉|按钮|输入框|下拉|表单|列表|表格|筛选|搜索|分页|提示|toast|展示|高亮|置灰|点击|悬停|失焦|联动|回显|默认值|校验|下载|导出|上传|打印/i,
];

const BACKEND_RECOMMEND_PATTERNS = [
  /接口|查询|保存|删除|新增|更新|同步|计算|生成|任务|批处理|导出|下载|上传|状态|记录|日志|数据/i,
];

const GENERIC_RECOMMEND_PATTERNS = [
  /模块|服务|流程|任务|作业|调度|脚本|命令|配置|环境变量|权限|鉴权|日志|监控|告警|迁移|表|schema|缓存|队列|重试|幂等|回滚|发布|部署|同步|集成|依赖/i,
];

export function collectRequirementFacts(
  texts: string[],
  projectType: ProjectType,
): RequirementFact[] {
  return uniqueFacts(
    texts
      .map((text) => text.trim())
      .filter((text) => text && !matchesAny(text, CLEAR_NOISE_PATTERNS))
      .map((text) => ({
        text,
        recommended: isRecommendedForProject(text, projectType),
      })),
  );
}

function isRecommendedForProject(text: string, projectType: ProjectType): boolean {
  if (projectType === 'frontend') {
    return matchesAny(text, FRONTEND_RECOMMEND_PATTERNS);
  }

  if (projectType === 'backend') {
    return matchesAny(text, BACKEND_RECOMMEND_PATTERNS);
  }

  if (projectType === 'fullstack') {
    return matchesAny(text, [...FRONTEND_RECOMMEND_PATTERNS, ...BACKEND_RECOMMEND_PATTERNS]);
  }

  return matchesAny(text, GENERIC_RECOMMEND_PATTERNS);
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function uniqueFacts(items: RequirementFact[]): RequirementFact[] {
  const seen = new Set<string>();
  const result: RequirementFact[] = [];

  for (const item of items) {
    const key = item.text;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}
