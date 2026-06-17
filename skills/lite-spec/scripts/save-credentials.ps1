param(
  [string]$YapiUid,
  [string]$YapiToken,
  [string]$FigmaToken
)

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

if (([string]::IsNullOrWhiteSpace($YapiUid) -xor [string]::IsNullOrWhiteSpace($YapiToken))) {
  throw "YApi credentials require both -YapiUid and -YapiToken"
}

if ([string]::IsNullOrWhiteSpace($YapiUid) -and [string]::IsNullOrWhiteSpace($YapiToken) -and [string]::IsNullOrWhiteSpace($FigmaToken)) {
  throw "Provide -YapiUid/-YapiToken or -FigmaToken"
}

$input = @{}
if ($YapiUid) { $input.yapiUid = $YapiUid }
if ($YapiToken) { $input.yapiToken = $YapiToken }
if ($FigmaToken) { $input.figmaToken = $FigmaToken }

$env:LITE_SPEC_INPUT = $input | ConvertTo-Json -Depth 4 -Compress
$env:LITE_SPEC_ENTRY = $entryPath

@'
async function main() {
const entryPath = process.env.LITE_SPEC_ENTRY;
const inputJson = process.env.LITE_SPEC_INPUT;
if (!entryPath) throw new Error("Missing LITE_SPEC_ENTRY");
if (!inputJson) throw new Error("Missing LITE_SPEC_INPUT");
const { saveCredentials } = await import(`file:///${entryPath}`);

const input = JSON.parse(inputJson);
const result = await saveCredentials(input);
console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@ | npx --prefix $engineDir tsx -
$exitCode = $LASTEXITCODE

Remove-Item Env:LITE_SPEC_INPUT -ErrorAction SilentlyContinue
Remove-Item Env:LITE_SPEC_ENTRY -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  exit $exitCode
}
