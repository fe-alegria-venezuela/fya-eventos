import type { Metadata, Viewport } from "next";
import "./globals.css";
import { EVENT } from "@/lib/env";

export const metadata: Metadata = {
  title: `Check-in · ${EVENT.name}`,
  description: `Sistema de check-in · ${EVENT.organizer}`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#d20b11",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
