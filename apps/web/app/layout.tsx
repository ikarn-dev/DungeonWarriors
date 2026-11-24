import type { Metadata } from "next";
import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import LobbyToaster from "../components/LobbyToaster";
import WalletProviders from "../components/WalletProviders";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pixel face for short in-game labels only; balances stay in Geist Mono.
const pixel = Pixelify_Sans({
  variable: "--font-pixel",
  subsets: ["latin"],
  weight: ["500", "700"],
});
export const metadata: Metadata = {
  title: "PURRPS",
  description:
    "Explore timed catacombs with collectible cats, treasure gates and MagicBlock-verifiable randomness on Solana Devnet.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixel.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <WalletProviders>{children}</WalletProviders>
        <LobbyToaster />
      </body>
    </html>
  );
}
