import type { MetadataRoute } from "next";

/** The review console is not for search engines. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] }],
    sitemap: `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3007"}/sitemap.xml`,
  };
}
