import type { Metadata, Viewport } from "next";
import { Cinzel, Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import LobbyToaster from "../components/LobbyToaster";
import RotateGate from "../components/RotateGate";
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

// Display face for the main-menu options and section titles only.
const display = Cinzel({
  variable: "--font-display",
  subsets: ["latin"],
});
export const metadata: Metadata = {
  title: "Dungeon Warriors",
  description:
    "Explore timed catacombs with collectible cats, treasure gates and MagicBlock-verifiable randomness on Solana Devnet.",
};

// The on-screen keyboard overlays the page instead of shrinking the layout
// viewport, so landscape typing never reads as portrait (rotate-gate.css).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-visual",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixel.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RotateGate />
        <WalletProviders>{children}</WalletProviders>
        <LobbyToaster />
      </body>
    </html>
  );
}
