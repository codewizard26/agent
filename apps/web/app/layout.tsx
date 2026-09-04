import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Job Agent",
  description: "A ranked board of open roles, fetched and triaged for you.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-10 border-b border-rule bg-paper/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
            <Link href="/" className="display text-[15px] font-extrabold tracking-tight">
              JOB AGENT
            </Link>
            <span className="eyebrow">Dispatch board</span>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-5xl px-6 pt-16 pb-10">
          <p className="font-mono text-[11px] text-ink-soft">
            Board refills every 4 hours. Nothing is submitted without you.
          </p>
        </footer>
      </body>
    </html>
  );
}
