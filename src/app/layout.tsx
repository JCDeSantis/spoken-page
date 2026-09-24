import type { Metadata, Viewport } from "next";
import "@/app/globals.css";
import { PwaStatus } from "@/components/pwa-status";

export const metadata: Metadata = {
  title: "Spoken Page",
  description: "A subtitle-ready Audiobookshelf web player for desktop and iPad.",
  applicationName: "Spoken Page",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Spoken Page",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#08050a",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <meta content="yes" name="mobile-web-app-capable" />
      </head>
      <body>
        <PwaStatus />
        {children}
      </body>
    </html>
  );
}
