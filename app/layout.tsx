import type { Metadata } from "next";
import { Geist, Geist_Mono, Onest } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** The groundtruth wordmark's face — used on the gate/front page and the app-shell logo. */
const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  weight: ["500"],
});

export const metadata: Metadata = {
  title: "Groundtruth",
  description: "A bespoke board effectiveness questionnaire, evidenced from the documents.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${onest.variable} h-full antialiased`}
      >
        <div className="min-h-full flex flex-col">{children}</div>
      </body>
    </html>
  );
}
