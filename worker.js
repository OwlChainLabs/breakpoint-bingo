// cloudflare worker: serves the page, plus a link and a share image per card.
// /c/<code>   the page with og tags pointing at this card's image
// /og/<code>.png  the card image (drawn by the og route on roast.owlchainlabs.xyz)
const OG_RENDER = "https://roast.owlchainlabs.xyz/api/bingo-og";

const AL="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-"; // "_" marks an own square
const toB64=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const b64d=s=>new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0)));
// short link code: 24 chars (pool index or "_"), "." marked squares as a bitmask, "." own texts
function packCard(c,m){let own=[],mask=0;const s=c.map(v=>typeof v==="number"?AL[v]:(own.push(v),"_")).join("");for(const i of m)if(i!==12)mask+=2**i;return s+"."+mask.toString(36)+(own.length?"."+toB64(JSON.stringify(own)):"")}
function unpackCard(code){
  if(code.startsWith("eyJ")){const d=JSON.parse(b64d(code));return{c:d.c,m:d.m||[]}} // first links
  const [s,mk,o]=code.split(".");if(!s||s.length!==24)throw 0;const own=o?JSON.parse(b64d(o)):[];let k=0;
  const c=[...s].map(ch=>{if(ch==="_")return String(own[k++]??"").slice(0,60);const n=AL.indexOf(ch);if(n<0)throw 0;return n});
  const mask=parseInt(mk||"0",36),m=[];for(let i=0;i<25;i++)if(mask&(2**i))m.push(i);return{c,m};
}

async function cardTexts(code, env, origin) {
  if (code.length > 4000) return null;
  try {
    const d = unpackCard(code);
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

    let m = url.pathname.match(/^\/og\/([A-Za-z0-9_.-]+)\.png$/);
    if (m) {
      const card = await cardTexts(m[1], env, url.origin);
      if (!card) return env.ASSETS.fetch(new Request(url.origin + "/og.png"));
      const res = await fetch(`${OG_RENDER}?d=${toB64(JSON.stringify(card))}`, { cf: { cacheEverything: true, cacheTtl: 86400 } });
      if (!res.ok) return env.ASSETS.fetch(new Request(url.origin + "/og.png"));
      return new Response(res.body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
    }

    m = url.pathname.match(/^\/c\/([A-Za-z0-9_.-]+)\/?$/);
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
