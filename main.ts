// Token launch radar: reads the sealed DefiLlama snapshot, scores every
// pre-token protocol with the radar-2 model (lib/model.ts), writes the ranked
// board to the output directory as board.json, writes data.js for the
// dashboard, copies dashboard/ and screenshots/ in, and writes dossier.json
// with the vendored library. Node 22, standard library only, no network.
//
// Usage: node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//   --input defaults to /input/snapshot.json (the grade-time path).
//   --output defaults to $MAKEFUN_OUTPUT_DIR, else /output.
// The output directory is created when missing. Only its CONTENTS are
// cleared, never the directory itself: the grader mounts it on a
// read-only filesystem and runs as an unprivileged user, so deleting the
// directory itself fails with EACCES.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const BOARD_SIZE = 200;
const DOSSIER_CAPS = {
  text_max_bytes: 65536,
  screenshots: { max: 4, max_bytes: 524288 },
  dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
};

function argValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
}

function resolveInput(input: string): string {
  const st = statSync(input);
  if (st.isDirectory()) return join(input, 'snapshot.json');
  return input;
}

function clearContents(dir: string): void {
  for (const entry of readdirSync(dir)) {
    rmSync(join(dir, entry), { recursive: true, force: true });
  }
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

function fail(message: string): never {
  console.error(`token-radar: GATE FAILED: ${message}`);
  process.exit(1);
}

/** The board gate, checked before anything is written. */
function checkGate(snapshot: Snapshot, rows: ReturnType<typeof buildBoard>['rows']): void {
  if (rows.length < 100 || rows.length > 4000) fail(`board holds ${rows.length} rows, need 100-4000`);
  const watchlist = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  let allEqual = true;
  let first: number | null = null;
  for (const row of rows) {
    if (seen.has(row.slug)) fail(`duplicate slug ${row.slug}`);
    seen.add(row.slug);
    if (!Number.isSafeInteger(row.rank) || row.rank < 1) fail(`bad rank ${row.rank} for ${row.slug}`);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      fail(`bad implied value ${row.implied_value_usd} for ${row.slug}`);
    }
    if (row.implied_value_usd > prev) fail(`implied value rises at rank ${row.rank}`);
    if (first === null) first = row.implied_value_usd;
    else if (row.implied_value_usd !== first) allEqual = false;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      fail(`${row.slug} has ${row.farm_steps.length} farm steps, need 3-12`);
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) fail(`${row.slug} farm step of ${len} chars, need 20-600`);
    }
  }
  for (let r = 1; r <= rows.length; r++) {
    if (!rows.some((row) => row.rank === r)) fail(`rank ${r} missing`);
  }
  if (allEqual && rows.length > 1) fail('all implied values are equal: not a ranking');
  for (const slug of watchlist) {
    if (!seen.has(slug)) fail(`watchlist slug ${slug} missing from the board`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const inputArg = argValue(argv, '--input') ?? '/input/snapshot.json';
  const outDir = resolve(argValue(argv, '--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const repoRoot = dirname(fileURLToPath(import.meta.url));

  const snapshot = JSON.parse(readFileSync(resolveInput(inputArg), 'utf8')) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    fail('snapshot has no protocols/watchlist arrays');
  }

  const { rows, live, overallMedian, medians } = buildBoard(snapshot, BOARD_SIZE);
  checkGate(snapshot, rows);

  mkdirSync(outDir, { recursive: true });
  clearContents(outDir);

  const board = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: 'radar-2: implied = TVL x 0.17 x chainF x momF x catF x matF (see dashboard model section)',
    rows: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      rank: r.rank,
      implied_value_usd: r.implied_value_usd,
      watchlist: r.watchlist,
      breakdown: r.breakdown,
      farm_steps: r.farm_steps,
    })),
  };
  writeFileSync(join(outDir, 'board.json'), JSON.stringify(board, null, 2) + '\n', 'utf8');

  const catMultiples: Record<string, { multiple: number; liveMedian: number | null; liveCount: number }> = {};
  for (const [cat, entry] of [...medians.entries()].sort()) {
    const raw = entry.n >= 3 ? entry.median / overallMedian : null;
    catMultiples[cat] = {
      multiple: raw === null ? 1 : Math.min(2, Math.max(0.5, raw)),
      liveMedian: entry.median,
      liveCount: entry.n,
    };
  }
  const data = {
    asOf: snapshot.as_of,
    source: snapshot.source,
    floorUsd: snapshot.floor_usd,
    model: {
      baseMultiple: 0.17,
      overallLiveMedian: overallMedian,
      chainStep: 0.08,
      chainCapCount: 6,
      momRate: 0.006,
      momMin: -50,
      momMax: 100,
      matBase: 0.7,
      matSpanDays: 1460,
      unknownAgeDays: 365,
      catClamp: [0.5, 2.0],
      catMultiples,
    },
    rows,
    live,
  };
  writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`, 'utf8');

  const dashSrc = join(repoRoot, 'dashboard');
  const shotsSrc = join(repoRoot, 'screenshots');
  if (!existsSync(join(dashSrc, 'index.html'))) fail('dashboard/index.html missing from the repository');
  if (!existsSync(shotsSrc)) fail('screenshots/ missing from the repository');
  copyTree(dashSrc, join(outDir, 'dashboard'));
  copyTree(shotsSrc, join(outDir, 'screenshots'));

  const dossier = buildDossier(outDir, DOSSIER_CAPS);
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const top = rows[0]!;
  console.log(
    `token-radar: ${rows.length} rows (${snapshot.watchlist.length} watchlist, ${rows.length - snapshot.watchlist.length} early), ` +
      `top ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')}, dossier ${dossier.length} bytes -> ${outDir}`,
  );
}

main();
