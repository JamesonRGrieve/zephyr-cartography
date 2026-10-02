#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# The whole gate, as parallel as the box allows. `pnpm gate` (CI) and the
# pre-commit hook (after lint-staged) both run it, so a commit and a PR are held
# to exactly the same checks.
#
# Phase 1 (parallel): every read-only analysis and ratchet, the unit tests with
#                     their coverage ratchet, Storybook, and the build followed
#                     by its size check, all at once. Each job logs to
#                     .husky/_logs/<label>-<ts>.log; a passing job's log is
#                     suppressed, a failing one's dumped with a [<label>]
#                     prefix so a failure in the fan-out is legible.
# Phase 2 (alone):    the e2e suite and its ratchet against the dist/ phase 1
#                     built, wherever a licensed Foundry release is present (as
#                     foundry-system's hook runs it). It runs last and alone
#                     because it fans out across isolated Foundry worlds sized
#                     to the RAM free when it starts (scripts/run-e2e.mjs);
#                     starting it beside the tsc passes would size it to memory
#                     they are about to take.
#
# Memory: three tsc --noEmit passes, type-coverage and vitest run at once in
# phase 1, several GB each.

set -u

ROOT="$(git rev-parse --show-toplevel)"
LOG_DIR="${ROOT}/.husky/_logs"
mkdir -p "${LOG_DIR}"
TS="$(date +%Y%m%d-%H%M%S)"
LABEL="${GATE_LABEL:-gate}"

PIDS=()
LABELS=()
LOGS=()
FAILED=0

run_bg() {
    local label="$1"
    shift
    local log="${LOG_DIR}/${label}-${TS}.log"
    echo "[${LABEL}] ▶ ${label}"
    ( "$@" ) >"$log" 2>&1 &
    PIDS+=("$!")
    LABELS+=("$label")
    LOGS+=("$log")
}

wait_all() {
    local i=0
    local pid
    local status
    for pid in "${PIDS[@]}"; do
        wait "$pid"
        status=$?
        if [ "$status" = "0" ]; then
            echo "[${LABEL}] ✓ ${LABELS[$i]}"
        else
            # 128+N means the job died from signal N (137 = killed), with nothing in its log.
            echo "[${LABEL}] ✗ ${LABELS[$i]} (exit ${status}; log: ${LOGS[$i]})" >&2
            sed "s|^|[${LABELS[$i]}] |" "${LOGS[$i]}" >&2
            FAILED=1
        fi
        i=$((i + 1))
    done
    PIDS=()
    LABELS=()
    LOGS=()
}

cd "${ROOT}" || exit 1

# ---------------------------------------------------------------------------
# Phase 1: everything but the e2e suite, at once.
# ---------------------------------------------------------------------------
echo "[${LABEL}] phase 1: checks, tests and build (parallel)"

# The slowest jobs start first so they overlap the rest.
run_bg "vitest"         bash -c './node_modules/.bin/vitest run --coverage && node scripts/coverage-ratchet.mjs'
run_bg "storybook"      pnpm -s test:storybook
run_bg "build-size"     bash -c 'pnpm -s build && pnpm -s size-limit'

# tsc passes — heaviest, several GB each.
run_bg "typecheck"      pnpm -s typecheck
run_bg "strict"         pnpm -s strict:ratchet
run_bg "test-typecheck" pnpm -s test:typecheck:ratchet
run_bg "type-coverage"  pnpm -s type-coverage:ratchet

# Whole-tree analyzers / ratchets.
run_bg "eslint"         pnpm -s lint:ratchet
run_bg "biome"          pnpm -s biome:ratchet
run_bg "ts"             pnpm -s ts:ratchet
run_bg "knip"           pnpm -s knip:ratchet
run_bg "deps"           pnpm -s deps:ratchet

# Formatting / style / supply-chain.
run_bg "format"         pnpm -s format
run_bg "stylelint"      pnpm -s stylelint
run_bg "lockfile"       pnpm -s lockfile:validate
run_bg "schema"         pnpm -s schema:check
run_bg "symmetry"       pnpm -s symmetry

wait_all
[ "$FAILED" = "0" ] || exit 1

# ---------------------------------------------------------------------------
# Phase 2: the e2e suite, fanned out across isolated Foundry worlds.
# ---------------------------------------------------------------------------
FOUNDRY_PROBE="${FOUNDRY_RELEASE_DIR:-${ROOT}/.foundry-release}/main.js"
if [ -f "${FOUNDRY_PROBE}" ]; then
    echo "[${LABEL}] phase 2: e2e (Foundry release found)"
    run_bg "e2e"        bash -c 'pnpm -s test:e2e && pnpm -s e2e:ratchet'
    wait_all
    [ "$FAILED" = "0" ] || exit 1
else
    echo "[${LABEL}] phase 2: e2e skipped — ${FOUNDRY_PROBE} not found (link a licensed release there to enable)"
fi

echo "[${LABEL}] all phases passed"
