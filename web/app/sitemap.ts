import type { MetadataRoute } from "next";
import { IS_SELF_HOSTED, SITE_URL } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", ...(!IS_SELF_HOSTED ? ["/pricing"] : []), "/docs", "/self-host", "/privacy", "/terms"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : 0.6,
  }));
}
