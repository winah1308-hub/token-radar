// Token Launch Radar — entry point (Node 22, standard library only).
//
// Reads the sealed snapshot, fits the value model from the snapshot's own
// live-token protocols, builds the ranked board, and writes the outputs:
//
//   board.json      the ranked board (rows 1..N by implied value)
//   data.js         the same data for the dashboard, as window.RADAR
//   dashboard/      a copy of this repo's dashboard/
//   screenshots/    a copy of this repo's screenshots/
//   dossier.json    buildDossier's summary, written last so it covers
//                   exactly what the two runs above wrote
//
// Usage (outside the grader's container, MAKEFUN_OUTPUT_DIR stands in
// for /output):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
//
// The run is deterministic: nothing here reads the clock, the network, or
// a random source, so two runs write byte-identical outputs.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** The value after `--name`, in `--name value` or `--name=value` form, else `fallback`. */
function arg(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (argv[i]!.startsWith(`--${name}=`)) return argv[i]!.slice(name.length + 3);
  }
  return fallback;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
// Self-check before writing anything: coverage of every watchlist slug
// (no wrapped exception — watchlist slugs are always ranked), ranks 1..N,
// non-increasing implied values, and farm-step lengths.
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dot-names; returns the names copied. */
function copyDir(from: string, to: string): string[] {
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

const dashboardFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashboardFiles.length === 0) fail('dashboard/ is empty: the page has nothing to copy');
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 — the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const v = radar.validation;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: model log10(mcap) = ${radar.fit.intercept} + ${radar.fit.slope} x log10(tvl), fitted on ${v.live_count} live-token protocols; leave-one-out median error x${v.median_factor_error}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
