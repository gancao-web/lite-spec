import { z } from 'zod';

export const sourceItemSchema = z.object({
  type: z.enum(['prototype', 'figma', 'api']),
  url: z.url(),
  status: z.enum(['pending', 'collected', 'failed']).default('pending'),
  title: z.string().default(''),
  summary: z.string().default(''),
  rawRef: z.string().default(''),
  structured: z.record(z.string(), z.any()).optional(),
});

export const intakeContextSchema = z.object({
  meta: z.object({
    version: z.literal('0.1'),
    generatedAt: z.iso.datetime(),
    repo: z.string().default(''),
    scope: z.string().default(''),
  }),
  projectProfile: z
    .object({
      type: z.enum(['frontend', 'backend', 'fullstack', 'generic']).default('generic'),
      signals: z.array(z.string()).default([]),
    })
    .default({
      type: 'generic',
      signals: [],
    }),
  businessGoal: z.string().default(''),
  frontendScope: z.array(z.string()).default([]),
  uiConstraints: z.array(z.string()).default([]),
  apiDependencies: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  scopedRequirementFacts: z
    .array(
      z.object({
        text: z.string(),
        recommended: z.boolean().default(false),
      }),
    )
    .default([]),
  sources: z.array(sourceItemSchema).default([]),
});

export type IntakeContext = z.infer<typeof intakeContextSchema>;

type DraftInput = {
  repo?: string;
  scope?: string;
  prototypeUrls: string[];
  figmaUrls: string[];
  apiUrls: string[];
};

export function createDraftContext(input: DraftInput): IntakeContext {
  const sources = [
    ...input.prototypeUrls.map((url) => createSource('prototype', url)),
    ...input.figmaUrls.map((url) => createSource('figma', url)),
    ...input.apiUrls.map((url) => createSource('api', url)),
  ];

  return intakeContextSchema.parse({
    meta: {
      version: '0.1',
      generatedAt: new Date().toISOString(),
      repo: input.repo ?? '',
      scope: input.scope ?? '',
    },
    projectProfile: {
      type: 'generic',
      signals: [],
    },
    sources,
  });
}

function createSource(type: 'prototype' | 'figma' | 'api', url: string) {
  return {
    type,
    url,
    status: 'pending' as const,
    title: '',
    summary: '',
    rawRef: '',
  };
}
