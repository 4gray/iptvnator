Write-Host "Starting Ruvo Player API Server..." -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "package.json")) {
    Write-Host "Error: package.json not found! Please run this script from the api folder." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Installing dependencies..." -ForegroundColor Yellow
try {
    npm install
    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed"
    }
}
catch {
    Write-Host "Failed to install dependencies: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Starting server..." -ForegroundColor Yellow
try {
    npm run dev
}
catch {
    Write-Host "Failed to start server: $_" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
