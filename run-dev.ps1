# Snowbo Snippets Windows 开发启动脚本

Write-Host "=== Starting Snowbo Snippets development environment ===" -ForegroundColor Cyan

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed. Please install Node.js >= 18" -ForegroundColor Red
    Write-Host "  Download: https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Node.js found: $(node --version)" -ForegroundColor Green

# 检查 Rust/Cargo
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust/Cargo is not installed." -ForegroundColor Red
    Write-Host "  Download rustup: https://rustup.rs/" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Rust/Cargo found: $(cargo --version)" -ForegroundColor Green

# 切换到项目根目录
Set-Location $PSScriptRoot

# 安装 npm 依赖
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] Installing npm dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install failed" -ForegroundColor Red
        exit 1
    }
}

# 确保 @tauri-apps/cli 已安装
if (-not (Test-Path "node_modules\.bin\tauri")) {
    Write-Host "[INFO] Installing Tauri CLI locally..." -ForegroundColor Yellow
    npm install --save-dev @tauri-apps/cli
}

# 启动 Tauri 开发模式
Write-Host "[INFO] Starting Tauri dev mode..." -ForegroundColor Cyan
Write-Host "  Frontend: http://localhost:3000" -ForegroundColor DarkGray
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray

npm run tauri:dev
