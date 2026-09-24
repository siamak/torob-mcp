#!/usr/bin/env node
/**
 * Drives the built binary through the MCP Inspector's CLI mode.
 *
 * The Inspector is the tool a human uses to check this server by hand, so exercising the same path
 * in CI catches a class of break the in-process tests cannot: a bad bin entry, a broken bundle, a
 * tool whose input schema the Inspector cannot render, or output that is not valid content.
 *
 *   node scripts/inspector-smoke.mjs          # offline: tools/list + the one tool that needs no network
 *   node scripts/inspector-smoke.mjs --live   # additionally calls one real tool per tool group
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../apps/node/dist/bin.mjs', import.meta.url));
const INSPECTOR = '@modelcontextprotocol/inspector';
const live = process.argv.includes('--live');

if (!existsSync(BIN)) {
  console.error(`${BIN} is missing - run "pnpm build" first`);
  process.exit(1);
}

const PRODUCT_ID = '57ea65ae-0798-4cd0-96a7-38d8af180345';

/** One call per tool group, so a break in any group's module surfaces here. */
const liveCalls = [
  ['search.ts', 'search_torob', ['query=ayfon', 'limit=3']],
  ['product.ts', 'product_details', [`product_id=${PRODUCT_ID}`]],
  ['sellers.ts', 'product_sellers', [`product_id=${PRODUCT_ID}`, 'limit=3']],
  ['insight.ts', 'torob_suggest', ['query=ayfon']],
];

/** The Inspector CLI exits 5 when a tool returns isError, which is a valid outcome to assert on. */
const TOOL_ERROR_EXIT = 5;

function inspector(args, { allowToolError = false } = {}) {
  // pnpm dlx, never npx: `npx <name>` can resolve to an unrelated package of the same name.
  const result = spawnSync('pnpm', ['dlx', INSPECTOR, '--cli', 'node', BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TOROB_LOG_LEVEL: 'silent' },
    timeout: 180_000,
  });
  const acceptable = result.status === 0 || (allowToolError && result.status === TOOL_ERROR_EXIT);
  if (!acceptable) {
    throw new Error(`inspector exited ${result.status}\n${result.stderr ?? ''}`);
  }
  // stdout carries progress chatter from pnpm before the JSON payload.
  const start = result.stdout.indexOf('{');
  if (start < 0) throw new Error(`no JSON in inspector output:\n${result.stdout}`);
  return JSON.parse(result.stdout.slice(start));
}

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`FAIL ${name}`);
  }
};

check('tools/list returns all 15 tools with descriptions', () => {
  const { tools } = inspector(['--method', 'tools/list']);
  if (tools.length !== 15) throw new Error(`expected 15 tools, got ${tools.length}`);
  for (const tool of tools) {
    if (typeof tool.description !== 'string' || tool.description.length < 80) {
      throw new Error(`${tool.name} has no usable description`);
    }
    if (tool.inputSchema?.type !== 'object') {
      throw new Error(`${tool.name} has no object input schema`);
    }
  }
});

check('tools/call product_url (no upstream request)', () => {
  const result = inspector([
    '--method',
    'tools/call',
    '--tool-name',
    'product_url',
    '--tool-arg',
    `product_id=${PRODUCT_ID}`,
  ]);
  const text = result.content?.[0]?.text ?? '';
  if (!text.includes(PRODUCT_ID)) throw new Error(`unexpected payload: ${text.slice(0, 200)}`);
});

check('tools/call rejects a malformed id with an actionable error', () => {
  const result = inspector(
    [
      '--method',
      'tools/call',
      '--tool-name',
      'product_details',
      '--tool-arg',
      'product_id=not-a-uuid',
    ],
    { allowToolError: true },
  );
  if (result.isError !== true) throw new Error('expected an error result');
  const text = result.content?.[0]?.text ?? '';
  // The message must tell the model what to do next, not merely that something failed.
  if (!text.includes('search_torob')) throw new Error(`error is not actionable: ${text}`);
});

if (live) {
  for (const [group, tool, args] of liveCalls) {
    check(`tools/call ${tool} (${group})`, () => {
      const result = inspector([
        '--method',
        'tools/call',
        '--tool-name',
        tool,
        ...args.flatMap((a) => ['--tool-arg', a]),
      ]);
      if (result.isError === true) {
        throw new Error(result.content?.[0]?.text ?? 'tool returned an error');
      }
      const text = result.content?.[0]?.text ?? '';
      JSON.parse(text); // output must be parseable JSON, not prose
    });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} inspector check(s) failed:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`\nAll inspector checks passed${live ? ' (including live calls)' : ''}.`);
