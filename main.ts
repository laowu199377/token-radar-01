// Token Radar — entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable pre-token protocol with the radar-2 model in
// lib/model.ts, writes the ranked board to /output/board.json, copies this
// repository's dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, clamp, GROWTH_CAP_PCT, GROWTH_FLOOR_PCT, MODEL_VERSION, type RankedRow } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
function boardIssue(board: RankedRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.protocol.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.protocol.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.protocol.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.protocol.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar({ snapshot, as_of: snapshot.as_of });
const issue = boardIssue(radar.board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

// board.json: one row per ranked protocol, in the gate's shape.
const boardRows = radar.board.map((r) => ({
  rank: r.rank,
  slug: r.protocol.slug,
  name: r.protocol.name,
  category: r.protocol.category,
  chains: r.protocol.chains,
  tvl_usd: r.protocol.tvl_usd,
  change_7d: r.protocol.change_7d,
  mcap_usd: r.protocol.mcap_usd,
  listed_at: r.protocol.listed_at,
  gecko_id: r.protocol.gecko_id,
  symbol: r.protocol.symbol,
  token_status: 'pre-token' as const,
  age_days: r.age_days,
  implied_value_usd: r.implied_value_usd,
  model: {
    base_multiple: radar.model.base_multiple,
    growth_pct: r.protocol.change_7d === null ? 0 : clamp(r.protocol.change_7d, GROWTH_FLOOR_PCT, GROWTH_CAP_PCT),
    growth_multiplier: r.growth_mult,
    maturity_multiplier: r.maturity_mult,
    age_days: r.age_days,
  },
  farm_steps: r.farm_steps,
}));
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);

// data.js: everything the dashboard renders, from the same board.
// The farm plan rides along in each row, so the page shows exactly what
// board.json holds — one source of truth, built in lib/model.ts.
const radarData = {
  as_of: radar.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model: radar.model,
  model_version: MODEL_VERSION,
  watchlist_size: snapshot.watchlist.length,
  board_size: radar.board.length,
  early_size: radar.board.filter((r) => !r.is_watchlist).length,
  live_size: radar.live.length,
  rows: radar.board.map((r) => ({
    rank: r.rank,
    slug: r.protocol.slug,
    name: r.protocol.name,
    category: r.protocol.category,
    chains: r.protocol.chains,
    tvl_usd: r.protocol.tvl_usd,
    change_7d: r.protocol.change_7d,
    mcap_usd: r.protocol.mcap_usd,
    listed_at: r.protocol.listed_at,
    age_days: r.age_days,
    implied_value_usd: r.implied_value_usd,
    growth_multiplier: r.growth_mult,
    maturity_multiplier: r.maturity_mult,
    is_watchlist: r.is_watchlist,
    // The farm plan comes from the same board the model wrote, so the page
    // shows exactly what board.json holds. The plan is built in lib/model.ts:
    // capital tier from the protocol's own TVL ($250 / $150 / $100 / $50),
    // hold length from its own age (60 / 45 / 30 days), main and second
    // actions chosen by category (lending, DEX, curator, prediction, RWA,
    // derivatives, stablecoin, default). Each step carries a dollar amount
    // and a time cost.
    farm_steps: r.farm_steps,
  })),
  live: radar.live.map((l) => ({
    slug: l.protocol.slug,
    name: l.protocol.name,
    category: l.protocol.category,
    chains: l.protocol.chains,
    tvl_usd: l.protocol.tvl_usd,
    mcap_usd: l.mcap_usd,
    change_7d: l.protocol.change_7d,
  })),
};
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radarData)};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${radar.board.length} rows scored (${radarData.early_size} early, ${radar.live.length} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
