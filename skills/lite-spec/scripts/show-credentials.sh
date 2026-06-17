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

npx --prefix "$ENGINE_DIR" tsx - --entry "$ENTRY_PATH" <<'EOF'
async function main() {
const args = process.argv.slice(2);
let entryPath = '';

for (let index = 0; index < args.length; index += 1) {
  const current = args[index];
  const next = args[index + 1] ?? '';

  switch (current) {
    case '--entry':
      entryPath = next;
      index += 1;
      break;
    default:
      throw new Error(`Unknown runtime argument: ${current}`);
  }
}

if (!entryPath) throw new Error('Missing --entry');

const {
  getCredentialsPath,
  getLiteSpecHome,
  readStoredCredentials,
} = await import(`file://${entryPath}`);

const credentials = await readStoredCredentials();
const result = {
  runtimeHome: getLiteSpecHome(),
  credentialsPath: getCredentialsPath(),
  hasYapi: Boolean(credentials.yapi?.uid && credentials.yapi?.token),
  yapiUpdatedAt: credentials.yapi?.updatedAt ?? null,
  hasFigma: Boolean(credentials.figma?.token),
  figmaUpdatedAt: credentials.figma?.updatedAt ?? null,
};

console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
EOF
