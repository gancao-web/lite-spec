#!/usr/bin/env bash
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/spec-engine" && pwd)"
ENTRY_PATH="$ENGINE_DIR/src/index.ts"

if [[ ! -d "$ENGINE_DIR/node_modules" ]]; then
  if [[ -f "$ENGINE_DIR/package-lock.json" ]]; then
    npm --prefix "$ENGINE_DIR" ci
  else
    npm --prefix "$ENGINE_DIR" install
  fi
fi

REPO=''
SCOPE=''
SLUG=''
JSON_INPUT=''
API_ARGS=()
PROTOTYPE_ARGS=()
FIGMA_ARGS=()
YAPI_UID=''
YAPI_TOKEN=''
FIGMA_TOKEN=''
POSITIONAL_ARGS=()

usage() {
  cat >&2 <<'USAGE'
Usage:
  run-spec.sh --repo <repo> --scope <scope> [--slug <slug>] [--api <url>] [--prototype <url>] [--figma <url>] [--figma-token <token>]
  run-spec.sh --json <json-input>
  run-spec.sh <repo> <scope> [slug] [json-input]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="${2:-}"
      shift 2
      ;;
    --scope)
      SCOPE="${2:-}"
      shift 2
      ;;
    --slug)
      SLUG="${2:-}"
      shift 2
      ;;
    --api)
      API_ARGS+=("${2:-}")
      shift 2
      ;;
    --prototype)
      PROTOTYPE_ARGS+=("${2:-}")
      shift 2
      ;;
    --figma)
      FIGMA_ARGS+=("${2:-}")
      shift 2
      ;;
    --yapi-uid)
      YAPI_UID="${2:-}"
      shift 2
      ;;
    --yapi-token)
      YAPI_TOKEN="${2:-}"
      shift 2
      ;;
    --figma-token)
      FIGMA_TOKEN="${2:-}"
      shift 2
      ;;
    --json)
      JSON_INPUT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      POSITIONAL_ARGS+=("$@")
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      POSITIONAL_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL_ARGS[@]} -gt 0 ]]; then
  REPO="${POSITIONAL_ARGS[0]:-$REPO}"
  SCOPE="${POSITIONAL_ARGS[1]:-$SCOPE}"
  SLUG="${POSITIONAL_ARGS[2]:-$SLUG}"
  JSON_INPUT="${POSITIONAL_ARGS[3]:-$JSON_INPUT}"
fi

RUN_ARGS=(--entry "$ENTRY_PATH")
if [[ -n "$JSON_INPUT" ]]; then
  RUN_ARGS+=(--json "$JSON_INPUT")
else
  if [[ -z "$REPO" || -z "$SCOPE" ]]; then
    usage
    exit 1
  fi

  RUN_ARGS+=(--repo "$REPO" --scope "$SCOPE")
  [[ -n "$SLUG" ]] && RUN_ARGS+=(--slug "$SLUG")
  [[ -n "$YAPI_UID" ]] && RUN_ARGS+=(--yapi-uid "$YAPI_UID")
  [[ -n "$YAPI_TOKEN" ]] && RUN_ARGS+=(--yapi-token "$YAPI_TOKEN")
  [[ -n "$FIGMA_TOKEN" ]] && RUN_ARGS+=(--figma-token "$FIGMA_TOKEN")
  for item in "${API_ARGS[@]}"; do RUN_ARGS+=(--api "$item"); done
  for item in "${PROTOTYPE_ARGS[@]}"; do RUN_ARGS+=(--prototype "$item"); done
  for item in "${FIGMA_ARGS[@]}"; do RUN_ARGS+=(--figma "$item"); done
fi

npx --prefix "$ENGINE_DIR" tsx - "${RUN_ARGS[@]}" <<'EOF'
async function main() {
const args = process.argv.slice(2);
let entryPath = '';
let input = {};

for (let index = 0; index < args.length; index += 1) {
  const current = args[index];
  const next = args[index + 1] ?? '';

  switch (current) {
    case '--entry':
      entryPath = next;
      index += 1;
      break;
    case '--json':
      input = JSON.parse(next);
      index += 1;
      break;
    case '--repo':
      input.repo = next;
      index += 1;
      break;
    case '--scope':
      input.scope = next;
      index += 1;
      break;
    case '--slug':
      input.slug = next;
      index += 1;
      break;
    case '--api':
      input.api = [...(input.api ?? []), next];
      index += 1;
      break;
    case '--prototype':
      input.prototype = [...(input.prototype ?? []), next];
      index += 1;
      break;
    case '--figma':
      input.figma = [...(input.figma ?? []), next];
      index += 1;
      break;
    case '--yapi-uid':
      input.yapiUid = next;
      index += 1;
      break;
    case '--yapi-token':
      input.yapiToken = next;
      index += 1;
      break;
    case '--figma-token':
      input.figmaToken = next;
      index += 1;
      break;
    default:
      throw new Error(`Unknown runtime argument: ${current}`);
  }
}

if (!entryPath) throw new Error('Missing --entry');
const { runCollect, runGenerate } = await import(`file://${entryPath}`);
const collectResult = await runCollect(input);
await runGenerate({
  contextData: collectResult.context,
  repo: input.repo,
  scope: input.scope,
  slug: input.slug,
  outDir: collectResult.outDir
});

console.log(JSON.stringify({
  outDir: collectResult.outDir
}, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
