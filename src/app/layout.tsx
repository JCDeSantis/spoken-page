import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Spoken Page",
  description: "A subtitle-ready Audiobookshelf web player for desktop and iPad.",
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
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
