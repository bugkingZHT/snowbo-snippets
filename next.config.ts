import type { NextConfig } from "next";

// Tauri 打包从 ../out 拿前端产物 -> 必须开 static export。
// 同时关掉 next/image 优化(纯静态环境没有 server)。
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;
