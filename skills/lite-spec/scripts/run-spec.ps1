param(
  [string]$Repo,
  [string]$Scope,
  [string]$Slug,
  [string]$Json,
  [string[]]$Api = @(),
  [string[]]$Prototype = @(),
  [string[]]$Figma = @(),
  [string]$YapiUid,
  [string]$YapiToken,
  [string]$FigmaToken
)

if (-not $Json) {
  if (-not $Repo) { throw "Missing -Repo" }
  if (-not $Scope) { throw "Missing -Scope" }
}

$engineDir = Join-Path $PSScriptRoot "spec-engine"
$entryPath = (Join-Path $engineDir "src\\index.ts").Replace('\', '/')
$inputJson = $Json
$nodeModules = Join-Path $engineDir "node_modules"

if (-not (Test-Path $nodeModules)) {
  $installCommand = if (Test-Path (Join-Path $engineDir "package-lock.json")) { "ci" } else { "install" }
  & npm --prefix $engineDir $installCommand
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

if (-not $inputJson) {
  $input = @{
    repo = $Repo
    scope = $Scope
    api = $Api
    prototype = $Prototype
    figma = $Figma
  }

  if ($Slug) { $input.slug = $Slug }
  if ($YapiUid) { $input.yapiUid = $YapiUid }
  if ($YapiToken) { $input.yapiToken = $YapiToken }
  if ($FigmaToken) { $input.figmaToken = $FigmaToken }

  $inputJson = $input | ConvertTo-Json -Depth 6 -Compress
}

$env:LITE_SPEC_INPUT = $inputJson
$env:LITE_SPEC_ENTRY = $entryPath

@'
async function main() {
const entryPath = process.env.LITE_SPEC_ENTRY;
const inputJson = process.env.LITE_SPEC_INPUT;
if (!entryPath) throw new Error("Missing LITE_SPEC_ENTRY");
if (!inputJson) throw new Error("Missing LITE_SPEC_INPUT");
const { runCollect, runGenerate } = await import(`file:///${entryPath}`);

const input = JSON.parse(inputJson);
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
'@ | npx --prefix $engineDir tsx -
$exitCode = $LASTEXITCODE

Remove-Item Env:LITE_SPEC_INPUT -ErrorAction SilentlyContinue
Remove-Item Env:LITE_SPEC_ENTRY -ErrorAction SilentlyContinue

if ($exitCode -ne 0) {
  exit $exitCode
}
