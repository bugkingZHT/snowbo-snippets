#!/bin/bash

# Snowbo Snippets 开发启动脚本

echo "🚀 Starting Snowbo Snippets development environment..."

# 检查依赖
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 18"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "❌ Rust/Cargo is not installed. Installing from Chinese mirror..."
    export RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static
    export RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup
    curl --proto '=https' --tlsv1.2 -sSf https://mirrors.ustc.edu.cn/rust-static/rustup/rustup-init.sh | sh
    source $HOME/.cargo/env
fi

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

# 检查并安装 Tauri CLI
if ! command -v tauri &> /dev/null; then
    echo "🔧 Installing Tauri CLI locally..."
    npm install --save-dev @tauri-apps/cli
fi

# 启动 Tauri 开发模式
echo "✨ Starting Tauri dev mode..."
npm run tauri:dev
