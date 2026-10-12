// cloudflare worker: serves the page, plus a link and a share image per card.
// /c/<code>   the page with og tags pointing at this card's image
// /og/<code>.png  the card image (drawn by the og route on roast.owlchainlabs.xyz)
const OG_RENDER = "https://roast.owlchainlabs.xyz/api/bingo-og";

const fromB64 = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)));
};
const toB64 = (s) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function cardTexts(code, env, origin) {
  if (code.length > 4000) return null;
  try {
    const d = JSON.parse(fromB64(code));
    if (!Array.isArray(d.c) || d.c.length !== 24) return null;
    const pool = await env.ASSETS.fetch(new Request(origin + "/pool.json")).then((r) => r.json());
    const c = d.c.map((v) => (typeof v === "number" ? pool[v] ?? "?" : String(v).slice(0, 60)));
    const m = (Array.isArray(d.m) ? d.m : []).filter((i) => Number.isInteger(i) && i >= 0 && i < 25);
    return { c, m };
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    let m = url.pathname.match(/^\/og\/([A-Za-z0-9_-]+)\.png$/);
    if (m) {
      const card = await cardTexts(m[1], env, url.origin);
      if (!card) return env.ASSETS.fetch(new Request(url.origin + "/og.png"));
      const res = await fetch(`${OG_RENDER}?d=${toB64(JSON.stringify(card))}`, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (!res.ok) return env.ASSETS.fetch(new Request(url.origin + "/og.png"));
      return new Response(res.body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }

    m = url.pathname.match(/^\/c\/([A-Za-z0-9_-]+)\/?$/);
    if (m) {
      const page = await env.ASSETS.fetch(new Request(url.origin + "/"));
      const card = await cardTexts(m[1], env, url.origin);
      let html = await page.text();
      if (card) {
        const img = `${url.origin}/og/${m[1]}.png`;
        html = html
          .replaceAll(`${url.origin}/og.png`, img)
          .replaceAll("https://bingo.owlchainlabs.xyz/og.png", img)
          .replace('content="https://bingo.owlchainlabs.xyz/"', `content="${url.origin}/c/${m[1]}"`)
          .replaceAll('content="breakpoint bingo"', 'content="my breakpoint bingo card"');
      }
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return env.ASSETS.fetch(request);
  },
};
