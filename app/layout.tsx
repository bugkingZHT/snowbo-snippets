import type { Metadata } from "next";
import Script from "next/script";
import { ThemeProvider } from '@/components/theme-provider'
import { AppConfigSync } from '@/components/app-config-sync'
import { THEME_INIT_SCRIPT } from '@/lib/theme-script'
import "./globals.css";

export const metadata: Metadata = {
  title: "Snowbo Snippets",
  description: "A modern code snippet notebook",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className="h-full">
      <body className="min-h-full h-screen w-screen overflow-hidden antialiased bg-background">
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
        >
          <AppConfigSync />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
