param(
  [string]$WebHost,
  [string]$WebUrl,
  [string]$WebCookie,
  [string]$WebHeadersJson,
  [string]$YapiUid,
  [string]$YapiToken,
  [string]$FigmaToken,
  [string]$DingtalkCookie,
  [string]$DingtalkXsrfToken,
  [string]$DingtalkAToken,
  [string]$DingtalkDocKey,
  [string]$DingtalkDentryKey
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

if ([string]::IsNullOrWhiteSpace($WebHost) -and [string]::IsNullOrWhiteSpace($YapiUid) -and [string]::IsNullOrWhiteSpace($YapiToken) -and [string]::IsNullOrWhiteSpace($FigmaToken) -and [string]::IsNullOrWhiteSpace($DingtalkCookie)) {
  throw "Provide generic web, YApi, Figma, or DingTalk credentials"
}

$input = @{}
if ($WebHost) { $input.webHost = $WebHost }
if ($WebUrl) { $input.webUrl = $WebUrl }
if ($WebCookie) { $input.webCookie = $WebCookie }
if ($WebHeadersJson) { $input.webHeadersJson = $WebHeadersJson }
if ($YapiUid) { $input.yapiUid = $YapiUid }
if ($YapiToken) { $input.yapiToken = $YapiToken }
if ($FigmaToken) { $input.figmaToken = $FigmaToken }
if ($DingtalkCookie) { $input.dingtalkCookie = $DingtalkCookie }
if ($DingtalkXsrfToken) { $input.dingtalkXsrfToken = $DingtalkXsrfToken }
if ($DingtalkAToken) { $input.dingtalkAToken = $DingtalkAToken }
if ($DingtalkDocKey) { $input.dingtalkDocKey = $DingtalkDocKey }
if ($DingtalkDentryKey) { $input.dingtalkDentryKey = $DingtalkDentryKey }

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
