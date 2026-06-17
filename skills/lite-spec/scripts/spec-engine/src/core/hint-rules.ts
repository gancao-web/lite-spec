export type NamedItem = {
  name: string;
};

export type RequirementMode = 'frontend' | 'service' | 'generic';

type SingleFieldRule = {
  patterns: readonly RegExp[];
  fallbackLabel: string;
};

const QUERY_RULES = {
  idLike: {
    patterns: [/(?:^|_)(?:id|ids)$/i, /id$/i],
    fallbackLabel: 'ID',
  },
  nameLike: {
    patterns: [/(?:^|_)(?:name|keyword|query|search)$/i],
    fallbackLabel: '名称或关键词',
  },
  page: {
    patterns: [/^page$/i],
    fallbackLabel: '分页页码',
  },
  limit: {
    patterns: [/^(limit|page_size|pageSize|size)$/i],
    fallbackLabel: '分页大小',
  },
  sort: {
    patterns: [/^(sort|sort_by|sortBy|order_by|orderBy)$/i],
    fallbackLabel: '排序字段',
  },
  order: {
    patterns: [/^(order|direction|sort_order|sortOrder)$/i],
    fallbackLabel: '排序方向',
  },
  start: {
    patterns: [/^(start|start_time|startTime|begin|begin_time|beginTime|from_date|fromDate)$/i],
    fallbackLabel: '开始时间',
  },
  end: {
    patterns: [/^(end|end_time|endTime|finish|finish_time|finishTime|to_date|toDate)$/i],
    fallbackLabel: '结束时间',
  },
  search: {
    patterns: [/^(keyword|keywords|search|query|q)$/i],
    fallbackLabel: '搜索词',
  },
} as const;

const RESPONSE_RULES = {
  status: {
    patterns: [/^(is_|has_|status|state|enabled?|disabled?)/i, /(_status|_state)$/i],
    fallbackLabel: '状态字段',
  },
  time: {
    patterns: [/(?:^|_)(?:time|at|date|updated_at|created_at)$/i],
    fallbackLabel: '时间字段',
  },
} as const;

export function getResponseFields(value: unknown): string[] {
  const responseBody = asObject(value);
  const properties = asObject(responseBody.properties);
  const data = asObject(properties.data);
  const itemProperties = asObject(asObject(data.items).properties);

  return Object.keys(itemProperties);
}

export function buildQueryQuestionHints(items: NamedItem[]): string[] {
  const questions: string[] = [];
  const names = items.map((item) => item.name);
  const idLikeFields = findAllMatches(names, QUERY_RULES.idLike);
  const nameLikeFields = findAllMatches(names, QUERY_RULES.nameLike);
  const pageField = findFirstMatch(names, QUERY_RULES.page);
  const limitField = findFirstMatch(names, QUERY_RULES.limit);
  const sortField = findFirstMatch(names, QUERY_RULES.sort);
  const orderField = findFirstMatch(names, QUERY_RULES.order);
  const startField = findFirstMatch(names, QUERY_RULES.start);
  const endField = findFirstMatch(names, QUERY_RULES.end);
  const searchField = findFirstMatch(names, QUERY_RULES.search);

  if (idLikeFields.length && nameLikeFields.length) {
    questions.push(
      `${idLikeFields[0]} 和 ${nameLikeFields[0]} 是同时必填，还是允许按其中一个条件单独筛选`,
    );
  }
  if (pageField || limitField) {
    questions.push(
      `${pageField ?? '分页页码'} 和 ${
        limitField ?? '分页大小'
      } 的默认值、最大值以及越界时的处理方式是否已经确认`,
    );
  }
  if (sortField || orderField) {
    questions.push(
      `${sortField ?? '排序字段'} 和 ${
        orderField ?? '排序方向'
      } 的可选值、默认值以及非法值处理方式是否已经确认`,
    );
  }
  if (startField || endField) {
    questions.push(
      `${startField ?? '开始时间'} 和 ${
        endField ?? '结束时间'
      } 的时间范围是否包含边界值、默认范围和时区规则是否已经确认`,
    );
  }
  if (searchField) {
    questions.push(`${searchField} 是否支持模糊匹配、最小输入长度以及空值时的查询行为是否已经确认`);
  }

  return questions;
}

export function buildResponseQuestionHints(
  fields: string[],
  mode: RequirementMode = 'generic',
): string[] {
  const questions: string[] = [];
  const statusField = findFirstMatch(fields, RESPONSE_RULES.status);
  const timeField = findFirstMatch(fields, RESPONSE_RULES.time);

  if (statusField) {
    questions.push(resolveStatusQuestion(statusField, mode));
  }
  if (timeField) {
    questions.push(resolveTimeQuestion(timeField, mode));
  }

  return questions;
}

export function buildResponseRiskHints(
  fields: string[],
  mode: RequirementMode = 'generic',
): string[] {
  const risks: string[] = [];
  const statusField = findFirstMatch(fields, RESPONSE_RULES.status);
  const timeField = findFirstMatch(fields, RESPONSE_RULES.time);

  if (statusField) {
    risks.push(resolveStatusRisk(statusField, mode));
  }
  if (timeField) {
    risks.push(resolveTimeRisk(timeField, mode));
  }

  return risks;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findFirstMatch(names: string[], rule: SingleFieldRule): string | undefined {
  return names.find((name) => matchesRule(name, rule));
}

function findAllMatches(names: string[], rule: SingleFieldRule): string[] {
  return names.filter((name) => matchesRule(name, rule));
}

function matchesRule(name: string, rule: SingleFieldRule): boolean {
  return rule.patterns.some((pattern) => pattern.test(name));
}

function resolveStatusQuestion(statusField: string, mode: RequirementMode): string {
  if (mode === 'frontend') {
    return `${statusField} 的不同取值在界面上如何展示，是否允许直接触发状态切换`;
  }

  if (mode === 'service') {
    return `${statusField} 的取值含义、状态流转条件，以及是否允许重试、回滚或人工干预是否已经确认`;
  }

  return `${statusField} 的取值含义、状态流转条件，以及对上下游行为的影响是否已经确认`;
}

function resolveTimeQuestion(timeField: string, mode: RequirementMode): string {
  if (mode === 'frontend') {
    return `${timeField} 的展示格式、时区以及为空时的兜底文案是否已经确认`;
  }

  if (mode === 'service') {
    return `${timeField} 的时区规则、边界取值、落库格式，以及与调度、重试或审计逻辑的关系是否已经确认`;
  }

  return `${timeField} 的时区规则、边界取值，以及在查询、排序、审计或同步场景中的处理方式是否已经确认`;
}

function resolveStatusRisk(statusField: string, mode: RequirementMode): string {
  if (mode === 'frontend') {
    return `${statusField} 的枚举含义若与界面状态映射不一致，容易导致状态显示或可操作性判断错误`;
  }

  if (mode === 'service') {
    return `${statusField} 的枚举含义若与服务端状态机、重试策略或权限判断不一致，容易导致流程卡死或误处理`;
  }

  return `${statusField} 的枚举含义若与上下游约定不一致，容易导致流程分支、权限判断或结果解释出现偏差`;
}

function resolveTimeRisk(timeField: string, mode: RequirementMode): string {
  if (mode === 'frontend') {
    return `${timeField} 若存在时区或格式差异，界面中的时间展示和排序结果可能不一致`;
  }

  if (mode === 'service') {
    return `${timeField} 若存在时区、精度或格式差异，可能影响调度、重试窗口、审计记录或数据对账`;
  }

  return `${timeField} 若存在时区、精度或格式差异，可能影响查询结果、排序、同步或审计判断`;
}
