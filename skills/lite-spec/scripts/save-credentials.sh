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

YAPI_UID=''
YAPI_TOKEN=''
FIGMA_TOKEN=''

usage() {
  cat >&2 <<'USAGE'
Usage:
  save-credentials.sh --yapi-uid <uid> --yapi-token <token>
  save-credentials.sh --figma-token <token>
  save-credentials.sh --yapi-uid <uid> --yapi-token <token> --figma-token <token>
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -n "$YAPI_UID" && -z "$YAPI_TOKEN" ]] || [[ -z "$YAPI_UID" && -n "$YAPI_TOKEN" ]]; then
  echo "YApi credentials require both --yapi-uid and --yapi-token" >&2
  exit 1
fi

if [[ -z "$YAPI_UID" && -z "$YAPI_TOKEN" && -z "$FIGMA_TOKEN" ]]; then
  usage
  exit 1
fi

npx --prefix "$ENGINE_DIR" tsx - --entry "$ENTRY_PATH" --yapi-uid "$YAPI_UID" --yapi-token "$YAPI_TOKEN" --figma-token "$FIGMA_TOKEN" <<'EOF'
async function main() {
const args = process.argv.slice(2);
let entryPath = '';
const input = {};

for (let index = 0; index < args.length; index += 1) {
  const current = args[index];
  const next = args[index + 1] ?? '';

  switch (current) {
    case '--entry':
      entryPath = next;
      index += 1;
      break;
    case '--yapi-uid':
      if (next) input.yapiUid = next;
      index += 1;
      break;
    case '--yapi-token':
      if (next) input.yapiToken = next;
      index += 1;
      break;
    case '--figma-token':
      if (next) input.figmaToken = next;
      index += 1;
      break;
    default:
      throw new Error(`Unknown runtime argument: ${current}`);
  }
}

if (!entryPath) throw new Error('Missing --entry');
const { saveCredentials } = await import(`file://${entryPath}`);
const result = await saveCredentials(input);
console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
