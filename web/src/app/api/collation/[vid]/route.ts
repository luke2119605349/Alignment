import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ vid: string }> };

const CNTR_ORIGIN = "https://greekcntr.org";

/**
 * Proxy CNTR collation data HTML and extract the table from body#collation.
 * Rewrites relative URLs so links/CSS resolve against greekcntr.org.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { vid } = await ctx.params;
  if (!/^\d{7,8}$/.test(vid)) {
    return NextResponse.json({ error: "Invalid vid" }, { status: 400 });
  }

  const upstream = `${CNTR_ORIGIN}/collation/data/${vid}.html`;
  let html: string;
  try {
    const res = await fetch(upstream, {
      headers: { Accept: "text/html" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Collation not found for ${vid}`, status: res.status },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    html = await res.text();
  } catch {
    return NextResponse.json({ error: "Failed to fetch collation" }, { status: 502 });
  }

  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : vid;

  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    return NextResponse.json({ error: "No collation table in response" }, { status: 502 });
  }

  let tableHtml = tableMatch[0];
  // Absolute-ify root-relative hrefs/srcs
  tableHtml = tableHtml.replace(
    /\b(href|src)=(["'])\/(?!\/)/gi,
    (_m, attr: string, q: string) => `${attr}=${q}${CNTR_ORIGIN}/`,
  );

  const cssHref = `${CNTR_ORIGIN}/collation/collation.css`;

  return NextResponse.json({
    vid,
    title,
    sourceUrl: `${CNTR_ORIGIN}/collation/index.html?&v=${vid}`,
    dataUrl: upstream,
    cssHref,
    tableHtml,
  });
}
