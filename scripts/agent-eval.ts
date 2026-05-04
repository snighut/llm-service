import { readFileSync } from 'fs';
import { resolve } from 'path';

type EvalCase = {
  name: string;
  query: string;
  minValidationScore?: number;
  maxDurationMs?: number;
};

type EvalResult = {
  name: string;
  passed: boolean;
  reasons: string[];
  designId?: string;
  validationScore?: number;
  processingTimeMs?: number;
  traceRunId?: string;
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

  return {
    name: testCase.name,
    passed: reasons.length === 0,
    reasons,
    designId,
    validationScore,
    processingTimeMs,
    traceRunId,
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
