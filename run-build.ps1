# Snowbo Snippets Windows 打包脚本
# 产物: src-tauri\target\release\bundle\nsis\Snowbo_Snippets_<version>_x64-setup.exe
#
# 用法:
#   .\run-build.ps1              # 构建 .exe (NSIS 安装包)
#   .\run-build.ps1 -SkipBundle  # 仅编译，不打包

param(
    [switch]$SkipBundle,
    [switch]$Release
)

$ErrorActionPreference = "Stop"

Write-Host "=== Snowbo Snippets Windows Build ===" -ForegroundColor Cyan

# 检查 Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed. Please install Node.js >= 18" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js: $(node --version)" -ForegroundColor Green

# 检查 Rust/Cargo
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Rust/Cargo is not installed." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Cargo: $(cargo --version)" -ForegroundColor Green

# 切换到项目根目录
Set-Location $PSScriptRoot

# 安装 npm 依赖
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] Installing npm dependencies..." -ForegroundColor Yellow
    npm install
} else {
    Write-Host "[INFO] node_modules exists, skip npm install" -ForegroundColor DarkGray
}

# 确保 Tauri CLI 已安装
if (-not (Test-Path "node_modules\.bin\tauri")) {
    Write-Host "[INFO] Installing Tauri CLI locally..." -ForegroundColor Yellow
    npm install --save-dev @tauri-apps/cli
}

# 清理上一次构建产物
Write-Host "[INFO] Cleaning previous build outputs..." -ForegroundColor Yellow
if (Test-Path "out") { Remove-Item -Recurse -Force "out" }
if (Test-Path ".next") { Remove-Item -Recurse -Force ".next" }

# 构建
if ($SkipBundle) {
    Write-Host "[INFO] Building frontend only (skip bundle)..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Frontend build failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Frontend built to out/" -ForegroundColor Green
    
    Write-Host "[INFO] Building Rust backend (debug)..." -ForegroundColor Cyan
    Set-Location src-tauri
    cargo build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Rust build failed" -ForegroundColor Red
        Set-Location ..
        exit 1
    }
    Set-Location ..
    Write-Host "[OK] Debug binary: src-tauri\target\debug\snowbo-snippets.exe" -ForegroundColor Green
} else {
    Write-Host "[INFO] Starting full Tauri build..." -ForegroundColor Cyan
    Write-Host "  This will: 1) npm run build -> out/  2) cargo build --release  3) bundle to .exe (NSIS)" -ForegroundColor DarkGray
    Write-Host "  First build may take 5-10 minutes..." -ForegroundColor DarkGray
    
    npx tauri build --bundles nsis
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Tauri build failed" -ForegroundColor Red
        exit 1
    }
    
    Write-Host ""
    Write-Host "=== Build Complete ===" -ForegroundColor Green
    Write-Host ""
    
    # 定位产物
    $bundleDir = "src-tauri\target\release\bundle"
    
    $msiDir = Join-Path $bundleDir "msi"
    if (Test-Path $msiDir) {
        $msiFiles = Get-ChildItem -Path $msiDir -Filter "*.msi" -ErrorAction SilentlyContinue
        foreach ($f in $msiFiles) {
            Write-Host "  .msi : $($f.FullName)" -ForegroundColor White
        }
    }
    
    $nsisDir = Join-Path $bundleDir "nsis"
    if (Test-Path $nsisDir) {
        $exeFiles = Get-ChildItem -Path $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue
        foreach ($f in $exeFiles) {
            Write-Host "  .exe : $($f.FullName)" -ForegroundColor White
        }
    }
}
