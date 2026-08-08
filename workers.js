const VT_BASE = "https://www.virustotal.com/api/v3";
const RELATIONSHIP = "resolutions";
const DEFAULT_LIMIT = 40;
const DEFAULT_MAX_PAGES = 50;
const PAGE_DELAY_MS = 500;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function isValidIpv4(ip) {
  const parts = String(ip || "").split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

function parseKeys(str) {
  const seen = new Set();
  for (const raw of String(str || "").split(",")) {
    const k = raw.trim();
    if (k) seen.add(k);
  }
  return [...seen];
}

function json(body, httpStatus, cacheTtl = 0) {
  const headers = {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  };
  const st = httpStatus || 200;
  // Cache hanya di browser (bukan edge/CDN): pakai max-age tanpa s-maxage/CDN-Cache-Control.
  if (cacheTtl > 0 && st >= 200 && st < 300) {
    headers["Cache-Control"] = `public, max-age=${cacheTtl}`;
  }
  return new Response(JSON.stringify(body), {
    status: st,
    headers,
  });
}

// Cache browser default 2 jam (7200s)
function parseCacheTtl(str) {
  let ttl = parseInt(str, 10);
  if (Number.isNaN(ttl) || ttl < 0) ttl = 7200;
  if (ttl > 86400) ttl = 86400;
  return ttl;
}

function envelope(status, opts = {}) {
  return {
    status,
    ip: opts.ip !== undefined ? opts.ip : null,
    domain: opts.domain !== undefined ? opts.domain : null,
    total: opts.total !== undefined ? opts.total : 0,
    domains: opts.domains || [],
    truncated: !!opts.truncated,
    dr: opts.dr !== undefined ? opts.dr : null,
    traffic: opts.traffic !== undefined ? opts.traffic : null,
    rank: opts.rank !== undefined ? opts.rank : null,
    links: opts.links !== undefined ? opts.links : null,
    age: opts.age !== undefined ? opts.age : null,
    created: opts.created !== undefined ? opts.created : null,
    message: opts.message !== undefined ? opts.message : null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function vtFetch(url, keys) {
  const available = [...keys];
  for (let attempt = 0; attempt < keys.length; attempt++) {
    if (available.length === 0) break;
    const key = available.shift();
    let resp;
    try {
      resp = await fetch(url, {
        headers: { "x-apikey": key },
      });
    } catch (e) {
      continue;
    }
    if (resp.status === 200 || resp.status === 404) {
      return { ok: resp.status === 200, status: resp.status, key, resp };
    }
    // 401/403 -> invalid key, drop it. 429/204 -> rate-limited, try next key.
    if (resp.status === 401 || resp.status === 403) {
      continue;
    }
    if (resp.status === 429 || resp.status === 204) {
      continue;
    }
    // Other errors: retry next key too.
    continue;
  }
  return { ok: false, status: "exhausted", key: null, resp: null };
}

async function collectDomains(ip, keys, limit, maxPages) {
  const domains = [];
  let url = `${VT_BASE}/ip_addresses/${ip}/${RELATIONSHIP}?limit=${limit}`;
  let pages = 0;
  let truncated = false;
  let lastStatus = null;

  while (url && pages < maxPages) {
    pages += 1;
    const { ok, status, resp } = await vtFetch(url, keys);
    lastStatus = status;
    if (!ok) break;
    if (status === 404) break;
    if (status !== 200) break;

    let body;
    try {
      body = await resp.json();
    } catch (e) {
      truncated = true;
      break;
    }

    const data = body && body.data ? body.data : [];
    for (const item of data) {
      const host = item && item.attributes && item.attributes.host_name;
      if (host && !domains.includes(host)) {
        domains.push(host);
      }
    }

    const meta = body && body.meta ? body.meta : {};
    const cursor = meta.cursor || meta.next_cursor;
    if (cursor) {
      url = `${VT_BASE}/ip_addresses/${ip}/${RELATIONSHIP}?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
      await sleep(PAGE_DELAY_MS);
    } else {
      url = null;
    }
  }

  if (pages >= maxPages) {
    truncated = true;
  }

  return { domains, truncated, lastStatus, pages };
}

async function handleRequest(request) {
  const requestUrl = new URL(request.url);
  const params = requestUrl.searchParams;
  const cacheTtl = parseCacheTtl(params.get("cache_ttl"));

  const type = (params.get("type") || "").trim().toLowerCase();
  if (!type) {
    return json(envelope("missing_params", { message: "Parameter 'type' wajib diisi" }), 400);
  }

  if (type === "virustotal") {
    return handleVirustotal(params, cacheTtl);
  }
  if (type === "ahrefs") {
    return handleAhrefs(params, cacheTtl);
  }
  if (type === "seoquake") {
    return handleSeoquake(params, cacheTtl);
  }

  return json(envelope("invalid_type", { message: `type tidak dikenal: ${type}` }), 400);
}

// ---------------------------------------------------------------------------
// TIPE: VIRUSTOTAL (resolutions)
// ---------------------------------------------------------------------------
async function handleVirustotal(params, cacheTtl) {
  const apiParam = (params.get("api") || "").trim();
  const ip = (params.get("ip") || "").trim();

  const keys = parseKeys(apiParam);

  if (!apiParam || keys.length === 0) {
    return json(envelope("missing_params", { message: "Parameter 'api' wajib diisi" }), 400);
  }
  if (!ip) {
    return json(envelope("missing_params", { message: "Parameter 'ip' wajib diisi" }), 400);
  }
  if (!isValidIpv4(ip)) {
    return json(envelope("invalid_ip", { message: `Format IP tidak valid: ${ip}` }), 400);
  }

  let limit = parseInt(params.get("limit"), 10);
  if (Number.isNaN(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > 200) limit = 200;

  let maxPages = parseInt(params.get("max_pages"), 10);
  if (Number.isNaN(maxPages) || maxPages <= 0) maxPages = DEFAULT_MAX_PAGES;
  if (maxPages > 200) maxPages = 200;

  const { domains, truncated, lastStatus, pages } = await collectDomains(ip, keys, limit, maxPages);

  if (lastStatus === "exhausted") {
    return json(envelope("rate_limited", {
      ip,
      total: domains.length,
      domains,
      truncated: true,
      message: "Semua API key rate-limited atau invalid sebelum selesai",
    }), 429, cacheTtl);
  }

  if (lastStatus === 404) {
    return json(envelope("not_found", {
      ip,
      message: `IP tidak dikenal oleh VirusTotal: ${ip}`,
    }), 404, cacheTtl);
  }

  if (lastStatus === 401 || lastStatus === 403) {
    return json(envelope("unauthorized", {
      ip,
      message: "API key VirusTotal tidak valid (401/403)",
    }), 401, cacheTtl);
  }

  return json(envelope("ok", {
    ip,
    total: domains.length,
    domains,
    truncated,
    message: null,
  }), 200, cacheTtl);
}

// ---------------------------------------------------------------------------
// TIPE: AHREFS (Domain Rating)
// ---------------------------------------------------------------------------
async function handleAhrefs(params, cacheTtl) {
  const domain = (params.get("domain") || "").trim();
  const api = (params.get("api") || "").trim();

  if (!api) {
    return json(envelope("missing_params", { message: "Parameter 'api' (Bearer token) wajib diisi" }), 400);
  }
  if (!domain) {
    return json(envelope("missing_params", { message: "Parameter 'domain' wajib diisi" }), 400);
  }

  let resp;
  try {
    resp = await fetch(`https://api.ahrefs.com/v3/public/domain-rating-free?target=${encodeURIComponent(domain)}&output=json`, {
      headers: { "Accept": "application/json", "Authorization": `Bearer ${api}` },
    });
  } catch (e) {
    return json(envelope("upstream_error", { domain, message: `ahrefs network error: ${e && e.message}` }), 502, cacheTtl);
  }

  if (resp.status === 429) {
    return json(envelope("rate_limited", { domain, message: "ahrefs rate limited (429)" }), 429, cacheTtl);
  }
  if (!resp.ok) {
    return json(envelope("upstream_error", { domain, message: `ahrefs HTTP ${resp.status}` }), 502, cacheTtl);
  }

  let body;
  try {
    body = await resp.json();
  } catch (e) {
    return json(envelope("upstream_error", { domain, message: "ahrefs response bukan JSON" }), 502, cacheTtl);
  }

  const raw = body.domain_rating !== undefined ? body.domain_rating : (body.dr !== undefined ? body.dr : null);
  const dr = typeof raw === "number" ? raw : (raw && typeof raw === "object" ? raw.domain_rating ?? null : null);
  return json(envelope("ok", { domain, dr }), 200, cacheTtl);
}

// ---------------------------------------------------------------------------
// TIPE: SEOQUAKE (Semrush public)
// ---------------------------------------------------------------------------
function xmlTag(text, tag) {
  const re = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[)?\\s*([^<]*?)\\s*(?:\\]\\]>)?\\s*</${tag}>`, "i");
  const m = text.match(re);
  return m && m[1] !== undefined ? m[1].trim() : null;
}

// Daftar multi-part TLD umum (heuristik) -> untuk dapat registrable domain dari subdomain
const MULTI_PART_TLDS = [
  // UK
  "co.uk","org.uk","ac.uk","gov.uk","me.uk","net.uk","ltd.uk","plc.uk","sch.uk","nhs.uk","police.uk",
  // Australia / NZ
  "com.au","net.au","org.au","edu.au","gov.au","id.au","asn.au",
  "co.nz","net.nz","org.nz","ac.nz","govt.nz","geek.nz","kiwi.nz",
  // Japan
  "co.jp","ne.jp","or.jp","ac.jp","go.jp","gr.jp","ad.jp","ed.jp",
  // Indonesia
  "co.id","or.id","ac.id","go.id","web.id","net.id","sch.id","mil.id","desa.id","biz.id","my.id","ponpes.id",
  // Brazil / Latam
  "com.br","net.br","org.br","gov.br","edu.br","art.br","adv.br","blog.br","eco.br","ind.br","inf.br","med.br","rec.br","srv.br","tmp.br","wiki.br",
  "com.mx","org.mx","net.mx","gob.mx","edu.mx",
  "com.ar","net.ar","org.ar","gob.ar","edu.ar",
  "com.co","net.co","org.co","edu.co","gov.co",
  "com.pe","net.pe","org.pe","gob.pe","edu.pe",
  "com.ve","net.ve","org.ve","gob.ve","edu.ve",
  "com.cl","net.cl","gob.cl","edu.cl",
  "com.bo","net.bo","org.bo","gob.bo","edu.bo",
  "com.ec","net.ec","org.ec","gob.ec","edu.ec",
  "com.uy","net.uy","org.uy","gub.uy","edu.uy",
  // China / Taiwan / Hong Kong
  "com.cn","net.cn","org.cn","gov.cn","edu.cn","ac.cn","mil.cn",
  "com.tw","net.tw","org.tw","edu.tw","gov.tw","idv.tw","club.tw","biz.tw",
  "com.hk","net.hk","org.hk","edu.hk","gov.hk","idv.hk",
  "com.mo","net.mo","org.mo","edu.mo","gov.mo",
  // Korea
  "co.kr","or.kr","ne.kr","ac.kr","re.kr","go.kr","mil.kr",
  "com.kr","net.kr","org.kr","edu.kr","gov.kr",
  // India / South Asia
  "com.in","net.in","org.in","ac.in","gov.in","res.in","gen.in","firm.in","ind.in",
  "co.in","biz.in",
  "com.pk","net.pk","org.pk","edu.pk","gov.pk","ac.pk",
  "com.bd","net.bd","org.bd","edu.bd","gov.bd",
  "com.np","net.np","org.np","edu.np","gov.np",
  "com.lk","net.lk","org.lk","edu.lk","gov.lk",
  // SE Asia
  "com.sg","net.sg","org.sg","edu.sg","gov.sg",
  "com.my","net.my","org.my","edu.my","gov.my",
  "co.th","in.th","ac.th","go.th","or.th","net.th",
  "com.ph","net.ph","org.ph","gov.ph","edu.ph",
  "com.vn","net.vn","org.vn","edu.vn","gov.vn",
  "co.id", "co.in", // dedup guard (idempotent, harmless)
  // Middle East
  "com.sa","net.sa","org.sa","gov.sa","edu.sa",
  "co.ae","net.ae","org.ae","ac.ae","gov.ae",
  "com.eg","net.eg","org.eg","edu.eg","gov.eg",
  "com.tr","net.tr","org.tr","edu.tr","gov.tr","av.tr",
  "com.ir","net.ir","org.ir","ac.ir","gov.ir",
  "co.il","org.il","ac.il","gov.il","muni.il","net.il",
  "com.qa","net.qa","org.qa","gov.qa","edu.qa",
  "com.om","net.om","org.om","gov.om","edu.om",
  "com.kw","net.kw","org.kw","edu.kw","gov.kw",
  // Europe
  "co.at","or.at","ac.at","gv.at",
  "co.nl","net.nl","org.nl","firm.nl","web.nl","amsterdam.nl",
  "co.be","net.be","org.be","ac.be",
  "com.es","net.es","org.es","gob.es","edu.es",
  "co.it","net.it","org.it","edu.it","gov.it",
  "com.pt","net.pt","org.pt","edu.pt","gov.pt",
  "com.fr","net.fr","org.fr","gouv.fr","asso.fr",
  "com.de","net.de","org.de","co.de",
  "co.ch","net.ch","org.ch","edu.ch",
  "com.ua","net.ua","org.ua","gov.ua","edu.ua","in.ua",
  "com.ru","net.ru","org.ru","edu.ru","gov.ru","msk.ru","spb.ru",
  "com.pl","net.pl","org.pl","edu.pl","gov.pl",
  "com.ro","net.ro","org.ro","edu.ro","gov.ro",
  "com.gr","net.gr","org.gr","edu.gr","gov.gr",
  "com.se","net.se","org.se",
  "co.no","net.no","org.no","com.no",
  "com.fi","net.fi","org.fi",
  "com.dk","net.dk","org.dk",
  "com.ee","net.ee","org.ee",
  "com.lv","net.lv","org.lv","gov.lv",
  "com.lt","net.lt","org.lt","gov.lt",
  "com.by","net.by","org.by","gov.by",
  "com.kz","net.kz","org.kz","edu.kz","gov.kz",
  "co.hr","com.hr","net.hr","org.hr",
  "com.rs","net.rs","org.rs","edu.rs","gov.rs",
  "com.si","net.si","org.si","gov.si",
  "com.sk","net.sk","org.sk","gov.sk",
  "com.cz","net.cz","org.cz",
  "com.hu","net.hu","org.hu","info.hu",
  "co.is","org.is","net.is",
  "com.mt","net.mt","org.mt","gov.mt",
  "com.cy","net.cy","org.cy","ac.cy","gov.cy",
  "com.lu","net.lu","org.lu",
  "com.ie","net.ie","org.ie","gov.ie",
  "co.im","net.im","org.im",
  // Africa
  "co.za","net.za","org.za","gov.za","ac.za","web.za","edu.za",
  "com.ng","net.ng","org.ng","edu.ng","gov.ng",
  "com.ke","net.ke","org.ke","ac.ke","go.ke",
  "com.gh","net.gh","org.gh","edu.gh","gov.gh",
  "com.tz","net.tz","org.tz","ac.tz","go.tz",
  "com.ug","net.ug","org.ug","ac.ug","go.ug",
  "co.tz", "co.ke", // dedup guard
  "com.et","net.et","org.et","edu.et","gov.et",
  "com.mu","net.mu","org.mu",
  "co.zw","org.zw","ac.zw","gov.zw",
  "com.na","net.na","org.na","edu.na",
  "com.mw","net.mw","org.mw","ac.mw","gov.mw",
  "com.zm","net.zm","org.zm","ac.zm","gov.zm",
  "co.bw","org.bw","ac.bw","gov.bw",
  "com.sd","net.sd","org.sd","edu.sd","gov.sd",
  "com.ly","net.ly","org.ly","edu.ly","gov.ly",
  "com.ma","net.ma","org.ma","gov.ma","ac.ma",
  "com.dz","net.dz","org.dz","gov.dz","edu.dz",
  "com.tn","net.tn","org.tn","gov.tn","edu.tn",
  "com.ci","net.ci","org.ci","edu.ci","gov.ci",
  // Other / misc
  "com.pr","net.pr","org.pr","edu.pr","gov.pr",
  "com.gt","net.gt","org.gt","gob.gt","edu.gt",
  "com.sv","net.sv","org.sv","gob.sv","edu.sv",
  "com.hn","net.hn","org.hn","gob.hn","edu.hn",
  "com.cr","net.cr","org.cr","go.cr","ed.cr",
  "com.pa","net.pa","org.pa","gob.pa","edu.pa",
  "com.ni","net.ni","org.ni","gob.ni","edu.ni",
  "com.do","net.do","org.do","gob.do","edu.do",
  "com.py","net.py","org.py","gov.py","edu.py",
  "com.cu","net.cu","org.cu","gov.cu","edu.cu",
  "com.bh","net.bh","org.bh","gov.bh","edu.bh",
  "com.jo","net.jo","org.jo","edu.jo","gov.jo",
  "com.lb","net.lb","org.lb","edu.lb","gov.lb",
  "com.ps","net.ps","org.ps","edu.ps","gov.ps",
  "com.sy","net.sy","org.sy","edu.sy","gov.sy",
  "com.iq","net.iq","org.iq","edu.iq","gov.iq",
  "com.ye","net.ye","org.ye","edu.ye","gov.ye",
  "com.mm","net.mm","org.mm","edu.mm","gov.mm",
  "com.kh","net.kh","org.kh","edu.kh","gov.kh",
  "com.la","net.la","org.la","edu.la","gov.la",
  "com.mn","net.mn","org.mn","edu.mn","gov.mn",
  "com.af","net.af","org.af","edu.af","gov.af",
  "com.az","net.az","org.az","edu.az","gov.az",
  "com.ge","net.ge","org.ge","edu.ge","gov.ge",
  "com.am","net.am","org.am","edu.am","gov.am",
  "com.uz","net.uz","org.uz","edu.uz","gov.uz",
  "com.tj","net.tj","org.tj","edu.tj","gov.tj",
  "com.kg","net.kg","org.kg","edu.kg","gov.kg",
  "com.tm","net.tm","org.tm","edu.tm","gov.tm",
  "com.mk","net.mk","org.mk","edu.mk","gov.mk",
  "com.al","net.al","org.al","edu.al","gov.al",
  "com.md","net.md","org.md","edu.md","gov.md",
  "com.ba","net.ba","org.ba","edu.ba","gov.ba",
  "com.me","net.me","org.me","ac.me","gov.me",
  "com.mk", // dedup guard
  "gen.tr","web.tr","info.tr","biz.tr","name.tr",
];

// Dapatkan registrable domain (eTLD+1) dengan heuristik multi-part TLD.
// "a.b.example.com" -> "example.com"; "a.b.co.uk" -> "b.co.uk"
function getRegistrableDomain(domain) {
  const labels = String(domain || "").toLowerCase().split(".").filter(Boolean);
  if (labels.length < 2) return labels.join(".");

  // cek public suffix multi-part terpanjang di akhir
  let suffixLen = 1;
  for (const tld of MULTI_PART_TLDS) {
    const tldLabels = tld.split(".");
    if (labels.slice(-tldLabels.length).join(".") === tld) {
      suffixLen = tldLabels.length;
      break;
    }
  }
  // eTLD+1 = satu label di atas public suffix
  const extra = labels.length - suffixLen - 1;
  const keep = Math.max(1, Math.min(extra, labels.length - 2));
  return labels.slice(-(keep + suffixLen)).join(".");
}

// Ambil tanggal registrasi domain via RDAP publik, lalu hitung usia (hari).
async function fetchDomainAge(domain) {
  const registrable = getRegistrableDomain(domain) || domain;
  try {
    const resp = await fetch(`https://rdap.verisign.com/com/v1/domain/${encodeURIComponent(registrable)}`, {
      headers: { "Accept": "application/rdap+json" },
    });
    if (!resp.ok) return { age: null, created: null };
    const body = await resp.json();
    const events = (body && body.events) || [];
    const reg = events.find(e => (e.eventAction || "").toLowerCase() === "registration");
    const created = reg && reg.eventDate ? reg.eventDate : null;
    if (!created) return { age: null, created: null };
    const createdMs = new Date(created).getTime();
    if (Number.isNaN(createdMs)) return { age: null, created: null };
    const age = Math.max(0, Math.floor((Date.now() - createdMs) / 86400000));
    return { age, created };
  } catch (e) {
    return { age: null, created: null };
  }
}

async function handleSeoquake(params, cacheTtl) {
  const domain = (params.get("domain") || "").trim();
  if (!domain) {
    return json(envelope("missing_params", { message: "Parameter 'domain' wajib diisi" }), 400);
  }

  let infoResp;
  try {
    infoResp = await fetch(`https://seoquake.publicapi.semrush.com/info.php?url=${encodeURIComponent(domain)}&ref=sq`);
  } catch (e) {
    return json(envelope("upstream_error", { domain, message: `seoquake network error: ${e && e.message}` }), 502, cacheTtl);
  }

  let infoText;
  try {
    infoText = await infoResp.text();
  } catch (e) {
    return json(envelope("upstream_error", { domain, message: "seoquake response tidak terbaca" }), 502, cacheTtl);
  }

  const status = (xmlTag(infoText, "status") || "").toLowerCase();
  if (status === "notfound") {
    return json(envelope("notfound", { domain, message: null }), 200, cacheTtl);
  }

  const squDomain = xmlTag(infoText, "domain") || domain;
  const traffic = xmlTag(infoText, "traffic");
  const rank = xmlTag(infoText, "rank");

  let links = "";
  try {
    const blResp = await fetch(`https://bl.publicapi.semrush.com/?url=${encodeURIComponent(squDomain)}&ref=sq`);
    if (blResp.ok) {
      const blText = await blResp.text();
      links = xmlTag(blText, "links") || "";
    }
  } catch (e) {
    // link lookup best-effort
  }

  const { age, created } = await fetchDomainAge(domain);

  return json(envelope("ok", { domain, traffic, rank, links, age, created }), 200, cacheTtl);
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return json(envelope("method_not_allowed", { message: "Hanya method GET" }), 405);
    }
    try {
      return await handleRequest(request);
    } catch (e) {
      return json(envelope("upstream_error", {
        message: `Error internal: ${e && e.message ? e.message : String(e)}`,
      }), 502);
    }
  },
};
