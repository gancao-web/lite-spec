param()

$engineDir = Join-Path $PSScriptRoot "spec-engine"
$entryPath = (Join-Path $engineDir "src\\index.ts").Replace('\', '/')
$nodeModules = Join-Path $engineDir "node_modules"

if (-not (Test-Path $nodeModules)) {
  $installCommand = if (Test-Path (Join-Path $engineDir "package-lock.json")) { "ci" } else { "install" }
  & npm --prefix $engineDir $installCommand
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

$env:LITE_SPEC_ENTRY = $entryPath

@'
async function main() {
const entryPath = process.env.LITE_SPEC_ENTRY;
if (!entryPath) throw new Error("Missing LITE_SPEC_ENTRY");
const { getCredentialsPath, getLiteSpecHome, readStoredCredentials } = await import(`file:///${entryPath}`);

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
'@ | npx --prefix $engineDir tsx -
$exitCode = $LASTEXITCODE

Remove-Item Env:LITE_SPEC_ENTRY -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  exit $exitCode
}
