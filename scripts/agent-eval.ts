import { readFileSync } from 'fs';
import { resolve } from 'path';

type EvalCase = {
  name: string;
  query: string;
  minValidationScore?: number;
  maxDurationMs?: number;
  rubricPath?: string;
  rubricMinCoverage?: number;
};

type EvalResult = {
  name: string;
  passed: boolean;
  reasons: string[];
  designId?: string;
  validationScore?: number;
  processingTimeMs?: number;
  traceRunId?: string;
  rubricCoverage?: number;
  rubricMatchedIntents?: string[];
  rubricMissingIntents?: string[];
};

type GenerateDesignResponse = {
  designId?: unknown;
  validationDetails?: {
    score?: unknown;
  };
  metadata?: {
    processingTimeMs?: unknown;
    traceRunId?: unknown;
  };
};

type RubricIntent = {
  key: string;
  description: string;
  componentAnyOf?: string[][];
  connectionAnyOf?: string[][];
  contextAnyOf?: string[][];
};

type ReferenceRubric = {
  name: string;
  description?: string;
  intents: RubricIntent[];
};

type TraceToolReplay = {
  tool?: unknown;
  toolInput?: unknown;
};

type DebugRunResponse = {
  run?: {
    toolReplay?: unknown;
  };
};

const baseUrl = process.env.EVAL_BASE_URL || 'http://localhost:3002';
const authToken = process.env.EVAL_AUTH_TOKEN || '';
const datasetPath =
  process.env.EVAL_DATASET_PATH || './scripts/agent-eval.dataset.json';

if (!authToken) {
  console.error('EVAL_AUTH_TOKEN is required to run agent evals.');
  process.exit(1);
}

const datasetAbsolutePath = resolve(process.cwd(), datasetPath);
const datasetRaw = readFileSync(datasetAbsolutePath, 'utf8');
const dataset = JSON.parse(datasetRaw) as EvalCase[];

if (!Array.isArray(dataset) || dataset.length === 0) {
  console.error('Dataset is empty or invalid.');
  process.exit(1);
}

function readRubric(rubricPath: string): ReferenceRubric | null {
  try {
    const absolutePath = resolve(process.cwd(), rubricPath);
    const rubricRaw = readFileSync(absolutePath, 'utf8');
    const parsed = JSON.parse(rubricRaw) as unknown;

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const rubric = parsed as Partial<ReferenceRubric>;
    if (!Array.isArray(rubric.intents) || rubric.intents.length === 0) {
      return null;
    }

    return {
      name: typeof rubric.name === 'string' ? rubric.name : 'Unnamed rubric',
      description:
        typeof rubric.description === 'string' ? rubric.description : '',
      intents: rubric.intents.filter(
        (intent): intent is RubricIntent =>
          !!intent &&
          typeof intent.key === 'string' &&
          typeof intent.description === 'string',
      ),
    };
  } catch {
    return null;
  }
}

function normalizeTokenGroups(input?: string[][]): string[][] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((group) => Array.isArray(group) && group.length > 0)
    .map((group) =>
      group
        .filter((token): token is string => typeof token === 'string')
        .map((token) => token.toLowerCase().trim())
        .filter((token) => token.length > 0),
    )
    .filter((group) => group.length > 0);
}

function containsTokenGroup(haystack: string, groups: string[][]): boolean {
  if (groups.length === 0) {
    return true;
  }

  return groups.some((group) =>
    group.every((token) => haystack.includes(token)),
  );
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyValue(entry)).join(' ');
  }
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((entry) => stringifyValue(entry))
      .join(' ');
  }
  return '';
}

function buildDesignCorpusFromToolInput(toolInput: unknown): {
  componentCorpus: string;
  connectionCorpus: string;
  contextCorpus: string;
} {
  if (!toolInput || typeof toolInput !== 'object') {
    return {
      componentCorpus: '',
      connectionCorpus: '',
      contextCorpus: '',
    };
  }

  const payload = toolInput as Record<string, unknown>;
  const itemsRaw = Array.isArray(payload.items) ? payload.items : [];
  const connectionsRaw = Array.isArray(payload.connections)
    ? payload.connections
    : [];

  const componentCorpus = itemsRaw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const record = item as Record<string, unknown>;
      return `${stringifyValue(record.name)} ${stringifyValue(record.type)} ${stringifyValue(record.displayName)}`;
    })
    .join(' ')
    .toLowerCase();

  const connectionCorpus = connectionsRaw
    .map((connection) => {
      if (!connection || typeof connection !== 'object') {
        return '';
      }
      const record = connection as Record<string, unknown>;
      return `${stringifyValue(record.from)} ${stringifyValue(record.to)} ${stringifyValue(record.label)} ${stringifyValue(record.connectionType)}`;
    })
    .join(' ')
    .toLowerCase();

  const contextCorpus = itemsRaw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }
      const record = item as Record<string, unknown>;
      return stringifyValue(record.context);
    })
    .join(' ')
    .toLowerCase();

  return {
    componentCorpus,
    connectionCorpus,
    contextCorpus,
  };
}

function evaluateRubricCoverage(
  rubric: ReferenceRubric,
  toolInput: unknown,
): {
  coverage: number;
  matchedIntents: string[];
  missingIntents: string[];
} {
  const { componentCorpus, connectionCorpus, contextCorpus } =
    buildDesignCorpusFromToolInput(toolInput);

  const matchedIntents: string[] = [];
  const missingIntents: string[] = [];

  for (const intent of rubric.intents) {
    const componentGroups = normalizeTokenGroups(intent.componentAnyOf);
    const connectionGroups = normalizeTokenGroups(intent.connectionAnyOf);
    const contextGroups = normalizeTokenGroups(intent.contextAnyOf);

    const componentOk = containsTokenGroup(componentCorpus, componentGroups);
    const connectionOk = containsTokenGroup(connectionCorpus, connectionGroups);
    const contextOk = containsTokenGroup(contextCorpus, contextGroups);

    if (componentOk && connectionOk && contextOk) {
      matchedIntents.push(intent.key);
    } else {
      missingIntents.push(intent.key);
    }
  }

  const total = rubric.intents.length;
  const coverage =
    total > 0 ? Math.round((matchedIntents.length / total) * 100) : 0;

  return {
    coverage,
    matchedIntents,
    missingIntents,
  };
}

async function fetchLatestMutationInputFromTrace(
  traceRunId: string,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/agent/debug/runs/${traceRunId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const bodyUnknown: unknown = await response.json();
  const body =
    bodyUnknown && typeof bodyUnknown === 'object'
      ? (bodyUnknown as DebugRunResponse)
      : {};

  const replayRaw = body.run?.toolReplay;
  if (!Array.isArray(replayRaw)) {
    return null;
  }

  const replay = replayRaw as TraceToolReplay[];
  for (let index = replay.length - 1; index >= 0; index -= 1) {
    const step = replay[index];
    if (!step || typeof step !== 'object') {
      continue;
    }

    const tool = typeof step.tool === 'string' ? step.tool : '';
    if (tool === 'create_system_design' || tool === 'update_system_design') {
      return step.toolInput ?? null;
    }
  }

  return null;
}

async function runCase(testCase: EvalCase): Promise<EvalResult> {
  const reasons: string[] = [];

  const response = await fetch(`${baseUrl}/agent/generate-design`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      query: testCase.query,
      options: {
        enableValidationLoop: true,
        validationThreshold: testCase.minValidationScore ?? 75,
        maxRefinementCycles: 2,
      },
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    return {
      name: testCase.name,
      passed: false,
      reasons: [`HTTP ${response.status}: ${bodyText.slice(0, 500)}`],
    };
  }

  const jsonUnknown: unknown = await response.json();
  const json: GenerateDesignResponse =
    jsonUnknown && typeof jsonUnknown === 'object'
      ? (jsonUnknown as GenerateDesignResponse)
      : {};

  const designId =
    typeof json.designId === 'string' ? json.designId : undefined;

  const rawValidationScore = json.validationDetails?.score;
  const validationScore =
    typeof rawValidationScore === 'number' ? rawValidationScore : undefined;

  const rawProcessingTimeMs = json.metadata?.processingTimeMs;
  const processingTimeMs =
    typeof rawProcessingTimeMs === 'number' ? rawProcessingTimeMs : undefined;

  const rawTraceRunId = json.metadata?.traceRunId;
  const traceRunId =
    typeof rawTraceRunId === 'string' ? rawTraceRunId : undefined;

  if (!designId) {
    reasons.push('Missing designId in response.');
  }

  if (
    typeof testCase.minValidationScore === 'number' &&
    typeof validationScore === 'number' &&
    validationScore < testCase.minValidationScore
  ) {
    reasons.push(
      `Validation score ${validationScore} is below minimum ${testCase.minValidationScore}.`,
    );
  }

  if (
    typeof testCase.maxDurationMs === 'number' &&
    typeof processingTimeMs === 'number' &&
    processingTimeMs > testCase.maxDurationMs
  ) {
    reasons.push(
      `Processing time ${processingTimeMs}ms exceeds maximum ${testCase.maxDurationMs}ms.`,
    );
  }

  let rubricCoverage: number | undefined;
  let rubricMatchedIntents: string[] | undefined;
  let rubricMissingIntents: string[] | undefined;

  if (
    typeof testCase.rubricPath === 'string' &&
    testCase.rubricPath.length > 0
  ) {
    const rubric = readRubric(testCase.rubricPath);
    if (!rubric) {
      reasons.push(`Rubric file could not be parsed: ${testCase.rubricPath}`);
    } else if (!traceRunId) {
      reasons.push('Trace run ID missing; cannot evaluate rubric coverage.');
    } else {
      const toolInput = await fetchLatestMutationInputFromTrace(traceRunId);
      if (!toolInput) {
        reasons.push(
          'Could not read tool replay payload for rubric evaluation.',
        );
      } else {
        const rubricEval = evaluateRubricCoverage(rubric, toolInput);
        rubricCoverage = rubricEval.coverage;
        rubricMatchedIntents = rubricEval.matchedIntents;
        rubricMissingIntents = rubricEval.missingIntents;

        const minCoverage =
          typeof testCase.rubricMinCoverage === 'number'
            ? testCase.rubricMinCoverage
            : 70;

        if (rubricCoverage < minCoverage) {
          reasons.push(
            `Rubric coverage ${rubricCoverage}% is below minimum ${minCoverage}%.`,
          );
        }
      }
    }
  }

  return {
    name: testCase.name,
    passed: reasons.length === 0,
    reasons,
    designId,
    validationScore,
    processingTimeMs,
    traceRunId,
    rubricCoverage,
    rubricMatchedIntents,
    rubricMissingIntents,
  };
}

async function main() {
  console.log(`Running ${dataset.length} eval cases against ${baseUrl}`);

  const results: EvalResult[] = [];
  for (const testCase of dataset) {
    console.log(`\nCase: ${testCase.name}`);
    const result = await runCase(testCase);
    results.push(result);

    if (result.passed) {
      console.log('Status: PASS');
    } else {
      console.log('Status: FAIL');
      for (const reason of result.reasons) {
        console.log(`  - ${reason}`);
      }
    }

    if (result.designId) {
      console.log(`Design ID: ${result.designId}`);
    }
    if (typeof result.validationScore === 'number') {
      console.log(`Validation Score: ${result.validationScore}`);
    }
    if (typeof result.processingTimeMs === 'number') {
      console.log(`Duration: ${result.processingTimeMs}ms`);
    }
    if (result.traceRunId) {
      console.log(`Trace Run ID: ${result.traceRunId}`);
    }
    if (typeof result.rubricCoverage === 'number') {
      console.log(`Rubric Coverage: ${result.rubricCoverage}%`);
    }
    if (result.rubricMatchedIntents && result.rubricMatchedIntents.length > 0) {
      console.log(
        `Rubric Matched Intents: ${result.rubricMatchedIntents.join(', ')}`,
      );
    }
    if (result.rubricMissingIntents && result.rubricMissingIntents.length > 0) {
      console.log(
        `Rubric Missing Intents: ${result.rubricMissingIntents.join(', ')}`,
      );
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  console.log('\nSummary');
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Eval run failed: ${message}`);
  process.exit(1);
});
