import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  EvalResult,
  EvalTestResult,
  InterviewLanguage,
} from "../types.js";
import type { HiddenTest } from "./problems.js";

/**
 * Eval runner (§4.5). Spawns an out-of-process `python3` / `node` harness that
 * loads the candidate's code, runs the hidden tests with wall-clock timing, and
 * streams one JSON line per test plus a summary. Deliberately Electron-free:
 * `process.execPath` under Electron is the app binary, so we prefer a plain
 * `node` on PATH and only fall back to the Electron binary with
 * ELECTRON_RUN_AS_NODE=1 when `node` is absent.
 *
 * Isolation: each run writes payload + user code + harness into a throwaway
 * sub-directory of the app's dataDir/tmp and deletes it afterwards. A hard 10s
 * whole-run timeout kills a runaway process; tests without a result line are
 * reported as `timeout` errors so an infinite loop still yields a scorecard.
 */

const RUN_TIMEOUT_MS = 10_000;
const INPUT_MAX = 200;

export interface RunTestsOpts {
  language: InterviewLanguage;
  functionName: string;
  tests: HiddenTest[];
  code: string;
  /** dataDir/tmp — created if missing. */
  tmpRoot: string;
  /** Whole-run kill deadline (default 10s). Lowered in tests. */
  timeoutMs?: number;
}

interface HarnessLine {
  type: "result" | "summary" | "compileError";
  name?: string;
  passed?: boolean;
  actual?: string;
  stdout?: string;
  error?: string;
  timeMs?: number;
  total?: number;
}

/** The core eval entry point — everything except the persisted attemptId. */
export async function runTests(
  opts: RunTestsOpts,
): Promise<Omit<EvalResult, "attemptId">> {
  const ranAt = new Date().toISOString();
  const started = Date.now();
  const dir = join(opts.tmpRoot, `run-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });

  const payloadPath = join(dir, "payload.json");
  const codePath = join(dir, opts.language === "python" ? "user.py" : "user.js");
  const harnessPath = join(dir, opts.language === "python" ? "harness.py" : "harness.cjs");
  writeFileSync(
    payloadPath,
    JSON.stringify({ functionName: opts.functionName, tests: opts.tests }),
  );
  writeFileSync(codePath, opts.code);
  writeFileSync(harnessPath, opts.language === "python" ? PY_HARNESS : JS_HARNESS);

  const cmd = resolveCommand(opts.language);

  let stdout = "";
  const lines: HarnessLine[] = [];
  let spawnError: string | null = null;
  let timedOut = false;

  try {
    await new Promise<void>((resolve) => {
      const child = spawn(cmd.command, [harnessPath, payloadPath, codePath], {
        cwd: dir,
        env: { ...process.env, ...cmd.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, opts.timeoutMs ?? RUN_TIMEOUT_MS);

      child.stdout.on("data", (b: Buffer) => {
        stdout += b.toString();
      });
      // stderr is drained but only surfaced when nothing parseable came back.
      let stderr = "";
      child.stderr.on("data", (b: Buffer) => {
        stderr += b.toString();
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        spawnError =
          (err as NodeJS.ErrnoException).code === "ENOENT"
            ? `${cmd.command} not found — cannot run ${opts.language} tests`
            : err.message;
        resolve();
      });
      child.on("close", () => {
        clearTimeout(timer);
        for (const raw of stdout.split("\n")) {
          const line = raw.trim();
          if (!line) continue;
          try {
            lines.push(JSON.parse(line) as HarnessLine);
          } catch {
            /* ignore stray non-JSON output */
          }
        }
        if (lines.length === 0 && stderr.trim() && !timedOut) {
          spawnError = lastLine(stderr);
        }
        resolve();
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const durationMs = Date.now() - started;

  if (spawnError) {
    return {
      passed: 0,
      total: opts.tests.length,
      results: [],
      compileError: spawnError,
      durationMs,
      ranAt,
    };
  }

  const compile = lines.find((l) => l.type === "compileError");
  if (compile) {
    return {
      passed: 0,
      total: opts.tests.length,
      results: [],
      compileError: compile.error ?? "compile error",
      durationMs,
      ranAt,
    };
  }

  const byName = new Map<string, HarnessLine>();
  for (const l of lines) if (l.type === "result" && l.name) byName.set(l.name, l);

  const results: EvalTestResult[] = opts.tests.map((t) => {
    const r = byName.get(t.name);
    const base: EvalTestResult = {
      name: t.name,
      passed: r?.passed ?? false,
      input: prettyCall(opts.functionName, t.args),
      expected: safeJson(t.expected),
      timeMs: r?.timeMs ?? 0,
    };
    if (r?.actual !== undefined) base.actual = r.actual;
    if (r?.stdout) base.stdout = r.stdout;
    if (r?.error) base.error = r.error;
    else if (!r) base.error = timedOut ? "timeout" : "no result";
    return base;
  });

  return {
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    results,
    durationMs,
    ranAt,
  };
}

/* ------------------------------- helpers -------------------------------- */

interface ResolvedCommand {
  command: string;
  env: Record<string, string>;
}

/** Cache the node resolution — `which node` costs a spawn we needn't repeat. */
let nodeCmdCache: ResolvedCommand | null = null;

function resolveCommand(language: InterviewLanguage): ResolvedCommand {
  if (language === "python") return { command: "python3", env: {} };
  if (nodeCmdCache) return nodeCmdCache;
  let cmd: ResolvedCommand;
  try {
    const probe = spawnSync("node", ["-v"], { stdio: "ignore" });
    cmd = probe.error
      ? { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } }
      : { command: "node", env: {} };
  } catch {
    cmd = { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: "1" } };
  }
  nodeCmdCache = cmd;
  return cmd;
}

function prettyCall(fn: string, args: unknown[]): string {
  const inner = args.map((a) => safeJson(a)).join(", ");
  const call = `${fn}(${inner})`;
  return call.length > INPUT_MAX ? `${call.slice(0, INPUT_MAX)}…)` : call;
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function lastLine(text: string): string {
  const parts = text.trim().split("\n").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : text.trim();
}

/* ------------------------------ harnesses ------------------------------- */

const PY_HARNESS = String.raw`import sys, json, io, time, traceback
from contextlib import redirect_stdout

STDOUT_CAP = 2048

def _key(x):
    try:
        return json.dumps(x, sort_keys=True)
    except Exception:
        return repr(x)

def _norm(v, mode):
    if isinstance(v, tuple):
        v = list(v)
    if mode == 'sortInner':
        if isinstance(v, list):
            if v and all(isinstance(e, (list, tuple)) for e in v):
                return [sorted(list(e), key=_key) for e in v]
            return sorted(v, key=_key)
        return v
    if mode == 'sortOuter':
        if isinstance(v, list):
            return sorted([list(e) if isinstance(e, tuple) else e for e in v], key=_key)
        return v
    return v

def _eq(a, b, mode):
    na, nb = _norm(a, mode), _norm(b, mode)
    try:
        return json.dumps(na, sort_keys=True) == json.dumps(nb, sort_keys=True)
    except Exception:
        return na == nb

def main():
    payload = json.load(open(sys.argv[1]))
    fn_name = payload['functionName']
    tests = payload['tests']
    src = open(sys.argv[2]).read()
    ns = {}
    try:
        with redirect_stdout(io.StringIO()):
            exec(compile(src, '<user>', 'exec'), ns)
    except Exception:
        print(json.dumps({'type': 'compileError', 'error': traceback.format_exc(limit=3)}), flush=True)
        return
    fn = ns.get(fn_name)
    if not callable(fn):
        print(json.dumps({'type': 'compileError', 'error': 'function ' + str(fn_name) + ' is not defined'}), flush=True)
        return
    passed = 0
    for t in tests:
        buf = io.StringIO()
        err = None
        actual = None
        ok = False
        start = time.perf_counter()
        try:
            with redirect_stdout(buf):
                actual = fn(*t['args'])
            ok = _eq(actual, t['expected'], t.get('normalize'))
        except Exception:
            lines = traceback.format_exc(limit=3).strip().splitlines()
            err = lines[-1] if lines else 'error'
        elapsed = (time.perf_counter() - start) * 1000.0
        if ok:
            passed += 1
        try:
            actual_json = json.dumps(actual)
        except Exception:
            actual_json = repr(actual)
        rec = {'type': 'result', 'name': t['name'], 'passed': ok, 'actual': actual_json, 'timeMs': round(elapsed, 3)}
        out = buf.getvalue()[:STDOUT_CAP]
        if out:
            rec['stdout'] = out
        if err:
            rec['error'] = err
        print(json.dumps(rec), flush=True)
    print(json.dumps({'type': 'summary', 'passed': passed, 'total': len(tests)}), flush=True)

main()
`;

const JS_HARNESS = String.raw`'use strict';
const fs = require('fs');
const vm = require('vm');
const STDOUT_CAP = 2048;

const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const userSrc = fs.readFileSync(process.argv[3], 'utf8');

function key(x) { try { return JSON.stringify(x); } catch (_) { return String(x); } }
function cmp(a, b) { const ka = key(a), kb = key(b); return ka < kb ? -1 : ka > kb ? 1 : 0; }
function norm(v, mode) {
  if (mode === 'sortInner') {
    if (Array.isArray(v)) {
      if (v.length && v.every(function (e) { return Array.isArray(e); })) {
        return v.map(function (e) { return e.slice().sort(cmp); });
      }
      return v.slice().sort(cmp);
    }
    return v;
  }
  if (mode === 'sortOuter') { return Array.isArray(v) ? v.slice().sort(cmp) : v; }
  return v;
}
function emit(o) { process.stdout.write(JSON.stringify(o) + '\n'); }

let buf = '';
function log() {
  const parts = Array.prototype.map.call(arguments, function (x) {
    return typeof x === 'string' ? x : key(x);
  });
  buf += parts.join(' ') + '\n';
}
const sandbox = {
  console: { log: log, error: function () {}, warn: function () {}, info: log },
  module: { exports: {} },
  exports: {},
  require: require,
  setTimeout: setTimeout,
  Math: Math,
  JSON: JSON,
};
sandbox.global = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

let fn;
try {
  vm.runInContext(userSrc, context, { timeout: 9000, filename: 'user.js' });
  fn = context[payload.functionName];
  if (typeof fn !== 'function' && typeof sandbox.module.exports === 'function') {
    fn = sandbox.module.exports;
  }
  if (typeof fn !== 'function' && sandbox.module.exports && typeof sandbox.module.exports[payload.functionName] === 'function') {
    fn = sandbox.module.exports[payload.functionName];
  }
} catch (e) {
  emit({ type: 'compileError', error: e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : String(e) });
  process.exit(0);
}
if (typeof fn !== 'function') {
  emit({ type: 'compileError', error: 'function ' + payload.functionName + ' is not defined' });
  process.exit(0);
}

let passed = 0;
for (const t of payload.tests) {
  buf = '';
  let err = null, actual, ok = false;
  const start = process.hrtime.bigint();
  try {
    actual = fn.apply(null, t.args);
    try { ok = JSON.stringify(norm(actual, t.normalize)) === JSON.stringify(norm(t.expected, t.normalize)); }
    catch (_) { ok = false; }
  } catch (e) { err = e && e.message ? e.message : String(e); }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
  if (ok) passed++;
  let actualJson;
  try { actualJson = JSON.stringify(actual); } catch (_) { actualJson = String(actual); }
  if (actualJson === undefined) actualJson = 'undefined';
  const rec = { type: 'result', name: t.name, passed: ok, actual: actualJson, timeMs: Math.round(elapsed * 1000) / 1000 };
  const out = buf.slice(0, STDOUT_CAP);
  if (out) rec.stdout = out;
  if (err) rec.error = err;
  emit(rec);
}
emit({ type: 'summary', passed: passed, total: payload.tests.length });
`;
