$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Source = Join-Path $Root "installer\windows\AmazonForbiddenKeywordCheckerSetup.cs"
$OutDir = Join-Path $Root "release"
$OutFile = Join-Path $OutDir "AmazonForbiddenKeywordCheckerSetup.exe"
$Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if (!(Test-Path -LiteralPath $Csc)) {
  $Csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (!(Test-Path -LiteralPath $Csc)) {
  throw "Could not find the .NET Framework C# compiler. Install .NET Framework Developer Pack or build on Windows with csc.exe available."
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

& $Csc `
  /nologo `
  /target:exe `
  /platform:anycpu `
  /optimize+ `
  /reference:System.Web.Extensions.dll `
  "/out:$OutFile" `
  $Source

Write-Host "Built installer: $OutFile"
