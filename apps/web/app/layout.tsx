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
            <Link href="/" className="display text-[15px] font-extrabold">
              Job Agent
            </Link>
            <span className="text-[13px] text-ink-soft">
              Refills daily
            </span>
          </div>
        </header>
        {children}
        <footer className="mx-auto max-w-5xl border-t border-rule px-6 pb-10 pt-6">
          <p className="text-[13px] text-ink-soft">
            Nothing is submitted without you. Every application stops for review
            before it is sent.
          </p>
        </footer>
      </body>
    </html>
  );
}
