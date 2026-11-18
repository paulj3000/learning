/**
 * Engineering documentation check (docs/engineering/documentation-policy.md, "Automated checks").
 *
 * Fails when:
 * - a required root instruction file, engineering document, adventure standard or template is missing;
 * - a governed document (CLAUDE.md, AGENTS.md, docs/engineering/**, docs/adventures/**, docs/adr/**)
 *   has a relative Markdown link to a file that does not exist;
 * - a document under docs/engineering/, docs/adventures/ or docs/adr/ has no `**Status:**` line in its
 *   first lines, or its status is not one of the documented values;
 * - a template lacks one of its required `## ` section headings;
 * - any Markdown file in the repository still contains a merge-conflict marker line.
 *
 * ADR identifiers are checked by `npm run adr:check` (scripts/check-adrs.ts), not here.
 * No network, no dependencies. `--root <dir>` points it at another tree (used by its test).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface DocsReport {
  errors: string[];
  filesChecked: number;
  linksChecked: number;
}

export const ROOT_INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md'];

export const ENGINEERING_DOCS = [
  'README.md',
  'development-workflow.md',
  'architecture-rules.md',
  'testing-policy.md',
  'branch-policy.md',
  'security-policy.md',
  'definition-of-done.md',
  'coding-standards.md',
  'multi-agent-workflow.md',
  'trello-workflow.md',
  'integration-policy.md',
  'release-policy.md',
  'documentation-policy.md',
  'product-baseline.md',
].map((name) => `docs/engineering/${name}`);

export const ADVENTURE_DOCS = [
  'README.md',
  'adventure-standard.md',
  'jumping-standard.md',
  'scoring-standard.md',
  'accessibility-standard.md',
  'realm-standard.md',
  'quest-standard.md',
  'challenge-standard.md',
  'asset-standard.md',
  'npc-standard.md',
  'audio-standard.md',
  'educational-content-standard.md',
].map((name) => `docs/adventures/${name}`);

/** Each template and the `## ` headings it must contain (exact words, case-insensitive). */
export const TEMPLATE_SECTIONS: Record<string, string[]> = {
  'docs/engineering/templates/feature-specification.md': [
    'Feature identifier',
    'Objective',
    'Business or educational value',
    'Requirements',
    'Nonrequirements',
    'Architecture',
    'Dependencies',
    'Data models',
    'API contracts',
    'Frontend changes',
    'Security implications',
    'Parallel work packages',
    'Serial work packages',
    'Testing strategy',
    'Acceptance criteria',
    'Deployment implications',
    'Owner decisions required',
  ],
  'docs/engineering/templates/task-specification.md': [
    'Ticket',
    'Objective',
    'Scope',
    'Out of scope',
    'Dependencies',
    'Owned components',
    'Shared components',
    'Acceptance criteria',
    'Test requirements',
    'Owner approval required',
  ],
  'docs/engineering/templates/implementation-plan.md': [
    'Ticket',
    'Baseline',
    'Audit findings',
    'Approach',
    'Files and components',
    'Shared component changes',
    'Test plan',
    'Risks',
    'Open questions',
  ],
  'docs/engineering/templates/agent-handoff.md': [
    'Agent ID',
    'Ticket ID',
    'Branch',
    'Worktree',
    'Commit SHA',
    'Completed work',
    'Remaining work',
    'Tests executed',
    'Test results',
    'Changed components',
    'Shared component changes',
    'Known defects',
    'Blockers',
    'Next recommended action',
  ],
  'docs/engineering/templates/pull-request.md': [
    'Summary',
    'Ticket',
    'Changes',
    'Tests executed',
    'Deferred checks',
    'Shared component changes',
    'Migrations',
    'Security and privacy',
    'Documentation',
    'Deployment impact',
    'Owner actions',
  ],
  'docs/engineering/templates/qa-checklist.md': [
    'Build under test',
    'Environment',
    'Devices',
    'Gameplay',
    'Movement and jumping',
    'Camera and collision',
    'Accessibility',
    'Audio',
    'Educational content',
    'Rewards and progress',
    'Parent controls',
    'Result',
  ],
  'docs/engineering/templates/defect-report.md': [
    'Defect ID',
    'Summary',
    'Severity',
    'Environment',
    'Steps to reproduce',
    'Expected result',
    'Actual result',
    'Evidence',
    'Suspected component',
    'Related ticket',
  ],
  'docs/engineering/templates/release-notes.md': [
    'Release identifier',
    'Environment',
    'Included changes',
    'Migrations',
    'Infrastructure changes',
    'Known issues',
    'Rollback plan',
    'Verification',
    'Approvals',
  ],
  'docs/engineering/templates/completion-report.md': [
    'Original scope',
    'Implemented scope',
    'Deferred scope',
    'Test evidence',
    'Commits',
    'Pull requests',
    'Documentation updates',
    'Trello updates',
    'Integration requirements',
    'Owner QA requirements',
    'Deployment status',
  ],
  'docs/adventures/templates/realm-specification.md': [
    'Realm identifier',
    'Theme and story',
    'Catalog mapping',
    'Places and 3D Areas',
    'Adventures',
    'Age bands',
    'Navigation and exits',
    'Assets',
    'NPCs',
    'Audio',
    'Accessibility',
    'Acceptance criteria',
    'Owner decisions required',
  ],
  'docs/adventures/templates/adventure-specification.md': [
    'Adventure identifier',
    'Realm association',
    'Educational objectives',
    'Age bands',
    'Story progression',
    'Environment',
    'Quests',
    'Challenges',
    'Movement and jumping',
    'Collectibles and rewards',
    'NPCs',
    'Audio',
    'Accessibility',
    'Failure recovery',
    'Progress persistence',
    'Parent-facing progress',
    'Assets',
    'Performance',
    'Acceptance criteria',
    'Owner decisions required',
  ],
  'docs/adventures/templates/quest-specification.md': [
    'Quest identifier',
    'Adventure association',
    'Objective',
    'Steps',
    'Completion conditions',
    'Rewards',
    'Progress tracking',
    'Failure recovery',
    'Acceptance criteria',
  ],
  'docs/adventures/templates/challenge-specification.md': [
    'Challenge identifier',
    'Challenge type',
    'Learning objective',
    'Age bands',
    'Content source',
    'Correctness rule',
    'Hints and fallback',
    'Accessibility alternative',
    'Jumping integration',
    'Progress evidence',
    'Acceptance criteria',
  ],
  'docs/adr/template.md': [
    'ADR identifier',
    'Title',
    'Status',
    'Date',
    'Context',
    'Decision',
    'Alternatives considered',
    'Consequences',
    'Security implications',
    'Implementation impact',
    'Related tickets',
    'Related ADRs',
    'Owner approval',
  ],
};

export const STATUS_VALUES = [
  'Mandatory',
  'Proposed',
  'Guidance',
  'Template',
  'Deprecated',
  'Superseded',
];

const GOVERNED_DIRS = ['docs/engineering', 'docs/adventures', 'docs/adr'];
const SKIPPED_DIRS = new Set([
  '.git',
  '.venv',
  'node_modules',
  'dist',
  '.amplify',
  'playwright-report',
  'test-results',
  '__pycache__',
  'cdk.out',
]);
const STATUS_LINE = /^>?\s*\*\*Status:\*\*\s*(\S.*)$/;
const STATUS_SEARCH_LINES = 12;
// `[text](target)` or `[text](target "title")`; images use the same syntax after `!`.
const LINK = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const CONFLICT_MARKER = /^(<{7}|>{7})(\s|$)/;

function walk(root: string, dir: string, keep: (name: string) => boolean, out: string[]): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(root, full, keep, out);
    else if (keep(name)) out.push(full);
  }
  return out;
}

const isMarkdown = (name: string) => name.endsWith('.md');

/** Lines outside fenced code blocks, with inline code spans removed, keyed by line number. */
function proseLines(text: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let fence: string | null = null;
  text.split('\n').forEach((line, index) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const token = marker[1] as string;
      if (fence === null) fence = token[0] as string;
      else if (token[0] === fence) fence = null;
      return;
    }
    if (fence !== null) return;
    out.push([index + 1, line.replace(/`[^`]*`/g, '')]);
  });
  return out;
}

function isExternal(target: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//');
}

export function checkDocs(root: string): DocsReport {
  const errors: string[] = [];
  let linksChecked = 0;

  const required = [
    ...ROOT_INSTRUCTION_FILES,
    ...ENGINEERING_DOCS,
    ...ADVENTURE_DOCS,
    ...Object.keys(TEMPLATE_SECTIONS),
    'docs/adr/README.md',
  ];
  for (const path of required) {
    if (!existsSync(join(root, path))) errors.push(`${path}: required document is missing`);
  }

  const governed = [
    ...ROOT_INSTRUCTION_FILES.map((path) => join(root, path)).filter((path) => existsSync(path)),
    ...GOVERNED_DIRS.flatMap((dir) => walk(root, join(root, dir), isMarkdown, [])),
  ];

  for (const file of governed) {
    const where = relative(root, file);
    const text = readFileSync(file, 'utf-8');

    for (const [line, prose] of proseLines(text)) {
      for (const match of prose.matchAll(LINK)) {
        const target = match[1] as string;
        if (isExternal(target) || target.startsWith('#')) continue;
        linksChecked += 1;
        const path = decodeURIComponent(target.split('#')[0]!.split('?')[0]!);
        const resolved = path.startsWith('/') ? join(root, path) : resolve(dirname(file), path);
        if (!existsSync(resolved)) {
          errors.push(`${where}:${line}: broken link "${target}"`);
        }
      }
    }

    if (GOVERNED_DIRS.some((dir) => where.startsWith(`${dir}/`))) {
      const head = text.split('\n').slice(0, STATUS_SEARCH_LINES);
      const status = head.map((line) => STATUS_LINE.exec(line)).find(Boolean);
      if (!status) {
        errors.push(`${where}: no "**Status:**" line in its first ${STATUS_SEARCH_LINES} lines`);
      } else {
        const value = (status[1] as string).trim();
        if (!STATUS_VALUES.some((allowed) => value.startsWith(allowed))) {
          errors.push(
            `${where}: status "${value}" is not one of ${STATUS_VALUES.join(', ')}`,
          );
        }
      }
    }
  }

  for (const [path, sections] of Object.entries(TEMPLATE_SECTIONS)) {
    const file = join(root, path);
    if (!existsSync(file)) continue;
    const headings = new Set(
      proseLines(readFileSync(file, 'utf-8'))
        .map(([, line]) => /^##\s+(.+?)\s*#*\s*$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => (match[1] as string).trim().toLowerCase()),
    );
    for (const section of sections) {
      if (!headings.has(section.toLowerCase())) {
        errors.push(`${path}: missing required section "## ${section}"`);
      }
    }
  }

  const markdown = walk(root, root, isMarkdown, []);
  for (const file of markdown) {
    readFileSync(file, 'utf-8')
      .split('\n')
      .forEach((line, index) => {
        if (CONFLICT_MARKER.test(line)) {
          errors.push(`${relative(root, file)}:${index + 1}: unresolved merge-conflict marker`);
        }
      });
  }

  return { errors, filesChecked: markdown.length, linksChecked };
}

function main(): void {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root =
    rootIndex >= 0
      ? resolve(args[rootIndex + 1] ?? '.')
      : resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = checkDocs(root);
  if (report.errors.length > 0) {
    console.error(`Documentation check failed with ${report.errors.length} problem(s):`);
    for (const error of report.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(
    `Documentation check passed: ${report.filesChecked} Markdown files, ${report.linksChecked} relative links in governed documents.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
