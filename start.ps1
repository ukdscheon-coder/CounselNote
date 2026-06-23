$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$url = "http://127.0.0.1:8790"
Write-Host "Starting CounselNote at $url"
Start-Process $url
node .\server.js
