import type { Metadata } from "next";
import Link from "next/link";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/sora/600.css";
import "@fontsource/sora/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/noto-sans-math/400.css";
import "./globals.css";
import { MathJaxLoader } from "@/components/mathjax-loader";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Banki — Remember on time", description: "Deadline-aware spaced repetition with FSRS." };

const themeScript = `
  try {
    const saved = localStorage.getItem("banki-theme");
    const theme = saved === "light" || saved === "dark"
      ? saved
      : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
  } catch (_) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head><body><MathJaxLoader /><header className="app-header"><Link className="brand" href="/"><span className="brand-mark">B</span><span>Banki<small>memory instrument</small></span></Link><div className="header-actions"><nav><Link href="/">Decks</Link><Link href="/statistics">History</Link><Link href="/settings">Settings</Link></nav><ThemeToggle /></div></header>{children}<footer className="app-footer"><span>Banki</span><span>Local data · FSRS 6 · Europe/Warsaw</span></footer></body></html>;
}
