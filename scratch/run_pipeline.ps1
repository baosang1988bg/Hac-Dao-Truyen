$env:PYTHONIOENCODING="utf-8"
$python_exe = "C:\Users\ADMIN\AppData\Local\Python\bin\python.exe"

Write-Host "=============================================" -ForegroundColor Green
Write-Host "🚀 STARTING FULL TRANSLATION & DEPLOY PIPELINE" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green

# 1. Run translation loop until Chapter 451
Write-Host "[1/3] Starting background translation loop..." -ForegroundColor Yellow
& $python_exe -u scratch/run_translate_loop.py

if ($LASTEXITCODE -eq 0) {
    Write-Host "[+] Translation completed successfully!" -ForegroundColor Green
} else {
    Write-Host "[!] Translation loop exited with error code: $LASTEXITCODE" -ForegroundColor Red
    Exit $LASTEXITCODE
}

# 2. Sync to Cloudflare D1 + R2
Write-Host "[2/3] Syncing translations to Cloudflare (D1 & R2)..." -ForegroundColor Yellow
& $python_exe -u migrate_to_cloudflare.py --slug lanh-chu-tranh-ba-bat-dau-tu-nam-tuoc-co-dao --smart-sync

if ($LASTEXITCODE -eq 0) {
    Write-Host "[+] Cloudflare sync completed successfully!" -ForegroundColor Green
} else {
    Write-Host "[!] Cloudflare sync failed with error code: $LASTEXITCODE" -ForegroundColor Red
    Exit $LASTEXITCODE
}

# 3. Build and deploy frontend
Write-Host "[3/3] Building frontend and deploying to Cloudflare Pages..." -ForegroundColor Yellow
npm run build:frontend
if ($LASTEXITCODE -eq 0) {
    Write-Host "[+] Frontend build succeeded!" -ForegroundColor Green
    npx wrangler deploy
    if ($LASTEXITCODE -eq 0) {
        Write-Host "🎉 SUCCESS: Application fully deployed!" -ForegroundColor Green
    } else {
        Write-Host "[!] Wrangler deployment failed!" -ForegroundColor Red
        Exit $LASTEXITCODE
    }
} else {
    Write-Host "[!] Frontend build failed!" -ForegroundColor Red
    Exit $LASTEXITCODE
}
