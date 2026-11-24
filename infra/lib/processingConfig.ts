import { parseSizing, type WorkloadSizing } from './processingWorkers';

/**
 * The committed production processing settings (`infra/config/prod-processing.json`, review F3).
 * Production synth reads them from the file only; an environment variable or CDK context value
 * for the same setting is accepted only when it agrees with the file, so a stale shell or a
 * missing flag can never synthesize a production template without the processing estate (which a
 * change set would then delete).
 */
export interface ProdProcessingConfig {
  prodProcessing: boolean;
  optimizeWorker: boolean;
  processingBudgetUsd?: number;
  processingSizing?: WorkloadSizing;
}

export const PROD_PROCESSING_CONFIG_PATH = 'infra/config/prod-processing.json';

/** Raw override values from context or the environment ('' when unset). */
export interface ProcessingOverrides {
  prodProcessing: string;
  optimizeWorker: string;
  processingBudgetUsd: string;
  processingSizing: string;
}

export function parseProdProcessingConfig(text: string): ProdProcessingConfig {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const known = [
    '$comment',
    'prodProcessing',
    'optimizeWorker',
    'processingBudgetUsd',
    'processingSizing',
  ];
  const unknown = Object.keys(raw).filter((key) => !known.includes(key));
  if (unknown.length)
    throw new Error(`${PROD_PROCESSING_CONFIG_PATH}: unknown keys ${unknown.join(', ')}`);
  if (typeof raw.prodProcessing !== 'boolean' || typeof raw.optimizeWorker !== 'boolean') {
    throw new Error(
      `${PROD_PROCESSING_CONFIG_PATH}: prodProcessing and optimizeWorker must be booleans`,
    );
  }
  const budget = raw.processingBudgetUsd;
  if (budget !== null && budget !== undefined && !(typeof budget === 'number' && budget > 0)) {
    throw new Error(`${PROD_PROCESSING_CONFIG_PATH}: processingBudgetUsd must be null or positive`);
  }
  const sizing = raw.processingSizing ?? {};
  return {
    prodProcessing: raw.prodProcessing,
    optimizeWorker: raw.optimizeWorker,
    processingBudgetUsd: typeof budget === 'number' ? budget : undefined,
    processingSizing: Object.keys(sizing as object).length
      ? parseSizing(JSON.stringify(sizing))
      : undefined,
  };
}

/** The file's settings, refusing any override that disagrees with them. */
export function resolveProdProcessing(
  fileText: string,
  overrides: ProcessingOverrides,
): ProdProcessingConfig {
  const config = parseProdProcessingConfig(fileText);
  const mismatch = (name: string, given: string, expected: string) => {
    if (given !== '' && given !== expected) {
      throw new Error(
        `${name}=${given} disagrees with ${PROD_PROCESSING_CONFIG_PATH} (${expected || 'unset'}): ` +
          'production processing settings change only in that committed file',
      );
    }
  };
  mismatch('prodProcessing', overrides.prodProcessing, String(config.prodProcessing));
  mismatch('optimizeWorker', overrides.optimizeWorker, String(config.optimizeWorker));
  if (overrides.processingBudgetUsd !== '') {
    mismatch(
      'processingBudgetUsd',
      String(Number(overrides.processingBudgetUsd)),
      config.processingBudgetUsd === undefined ? '' : String(config.processingBudgetUsd),
    );
  }
  if (overrides.processingSizing !== '') {
    mismatch(
      'processingSizing',
      JSON.stringify(parseSizing(overrides.processingSizing) ?? {}),
      JSON.stringify(config.processingSizing ?? {}),
    );
  }
  return config;
}
