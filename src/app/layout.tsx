import type { Metadata, Viewport } from "next";
import "@/app/globals.css";

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

const themeBootstrapScript = `
  try {
    var savedTheme = window.localStorage.getItem("shelf-sync-theme");
    document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";
  } catch {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-theme="dark" lang="en" suppressHydrationWarning>
      <head>
        <meta content="yes" name="mobile-web-app-capable" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
