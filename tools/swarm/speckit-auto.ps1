# Launcher cho /speckit-auto trên Windows.
# Dùng: powershell -ExecutionPolicy Bypass -File tools/swarm/speckit-auto.ps1 "Mô tả tính năng"
#       powershell -ExecutionPolicy Bypass -File tools/swarm/speckit-auto.ps1 -Demo
param(
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Request,
  [switch]$Demo,
  [double]$Budget = 0,
  [int]$Port = 8765
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

$root = (git rev-parse --show-toplevel).Trim()
Set-Location $root
git config --global core.longpaths true 2>$null

# Chọn Python 3.11+ (py launcher trước, rồi python trong PATH)
$exe = $null; $pre = @()
foreach ($cand in @("py -3.12", "py -3.11", "python")) {
  $parts = $cand.Split(" ")
  $e = $parts[0]; $p = @($parts | Select-Object -Skip 1)
  if (-not (Get-Command $e -ErrorAction SilentlyContinue)) { continue }
  $v = & $e @p -c "import sys;print(sys.version_info>=(3,11))" 2>$null
  if ($v -eq "True") { $exe = $e; $pre = $p; break }
}
if (-not $exe) { Write-Error "Cần Python 3.11+ (cài từ python.org hoặc 'winget install Python.Python.3.12')."; exit 1 }

& $exe @pre -c "import fastapi, uvicorn, httpx" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Cài dependency của swarm (fastapi, uvicorn, httpx)..."
  & $exe @pre -m pip install -r tools/swarm/requirements.txt
}

if (-not (Test-Path ".env.swarm") -and -not $Demo) {
  Write-Warning "Chưa có .env.swarm — sao chép tools/swarm/env.swarm.example thành .env.swarm rồi điền API key (hoặc chạy -Demo)."
}

$argsList = @("-m", "tools.swarm")
if ($Demo) { $argsList += "demo" } else { $argsList += "auto" }
if ($Budget -gt 0) { $argsList += @("--budget", "$Budget") }
$argsList += @("--port", "$Port")
if ($Request) { $argsList += ($Request -join " ") }
& $exe @pre @argsList
