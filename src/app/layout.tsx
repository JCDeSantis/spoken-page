import type { Metadata } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Spoken Page",
  description: "A subtitle-ready Audiobookshelf web player for desktop and iPad.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
