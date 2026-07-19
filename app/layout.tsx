'use client';

import '../styles/globals.css';
import NavBar from '../components/NavBar';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Spello</title>
        <meta name="description" content="Spello — a German vocabulary trainer for B2 learners" />
      </head>
      <body className="bg-slate-50 min-h-screen text-slate-800">
        <NavBar />
        <main className="max-w-2xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
