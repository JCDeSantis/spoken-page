import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Spoken Page",
    short_name: "Spoken Page",
    description: "A subtitle-ready Audiobookshelf web player for desktop and iPad.",
    start_url: "/",
    display: "standalone",
    background_color: "#08050a",
    theme_color: "#08050a",
  };
}
