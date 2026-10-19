/** Splits the package into the exported files and builds the manifest (LAI-0302). */
import { createHash } from 'node:crypto';
import { canonicalJson, toJsonValue, type JsonValue } from './canonical';
import { checkIntegrity, type Ambiguity } from './integrity';
import { CONTENT_SCHEMA, schemaForFile, validate } from './schema';
import {
  EXPORT_TOOL,
  FILE_LAYOUT,
  SCHEMA_VERSION,
  type ContentFileName,
  type ContentPackage,
} from './types';

export const SCHEMA_PATH = 'content/schema/content.schema.json';
export const EXPORT_DIR = 'content/exported';

export class ContentExportError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Content export failed with ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    this.name = 'ContentExportError';
    this.problems = problems;
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface ExportResult {
  /** Path relative to the repository root -> exact file contents. */
  files: Record<string, string>;
  ambiguities: Ambiguity[];
}

/** Validates, checks integrity, and renders every file. Throws `ContentExportError` on any problem. */
export function renderExport(pkg: ContentPackage): ExportResult {
  const problems: string[] = [];
  const report = checkIntegrity(pkg);
  problems.push(...report.errors);

  const bodies: Record<string, JsonValue> = {};
  const counts: Record<string, Record<string, number>> = {};
  for (const [name, collections] of Object.entries(FILE_LAYOUT)) {
    const body: Record<string, unknown> = { schemaVersion: SCHEMA_VERSION };
    counts[name] = {};
    for (const key of collections) {
      body[key] = pkg[key];
      counts[name][key] = pkg[key].length;
    }
    const json = toJsonValue(body, name);
    for (const error of validate(json, schemaForFile(name as ContentFileName), name)) {
      problems.push(`schema: ${error}`);
    }
    bodies[name] = json;
  }
  if (problems.length > 0) throw new ContentExportError(problems);

  const rendered: Record<string, string> = {};
  const entries = Object.keys(FILE_LAYOUT).map((name) => {
    const text = canonicalJson(bodies[name] as JsonValue);
    rendered[name] = text;
    return { path: name, sha256: sha256(text), counts: counts[name] as Record<string, number> };
  });
  const manifest = toJsonValue({
    schemaVersion: SCHEMA_VERSION,
    exportTool: EXPORT_TOOL,
    contentDigest: sha256(entries.map((e) => `${e.path}:${e.sha256}`).join('\n')),
    files: entries,
    knownAmbiguities: report.ambiguities,
  });
  for (const error of validate(manifest, schemaForFile('manifest.json'), 'manifest.json')) {
    problems.push(`schema: ${error}`);
  }
  if (problems.length > 0) throw new ContentExportError(problems);

  const files: Record<string, string> = {
    [SCHEMA_PATH]: canonicalJson(toJsonValue(CONTENT_SCHEMA)),
    [`${EXPORT_DIR}/manifest.json`]: canonicalJson(manifest),
  };
  for (const [name, text] of Object.entries(rendered)) files[`${EXPORT_DIR}/${name}`] = text;
  return { files, ambiguities: report.ambiguities };
}
