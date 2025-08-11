Write-Host "Starting Ruvo Player with Local API Server..." -ForegroundColor Green
Write-Host ""

# Step 1: Start API Server
Write-Host "Step 1: Starting API Server..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd api; npm run dev" -WindowStyle Normal

# Step 2: Wait for API server to start
Write-Host "Step 2: Waiting for API server to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Step 3: Start Angular App
Write-Host "Step 3: Starting Angular App..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run serve" -WindowStyle Normal

Write-Host ""
Write-Host "Both servers are starting..." -ForegroundColor Green
Write-Host "- API Server: http://localhost:3333" -ForegroundColor Cyan
Write-Host "- Angular App: http://localhost:4200" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Enter to close this window..." -ForegroundColor Yellow
Read-Host
