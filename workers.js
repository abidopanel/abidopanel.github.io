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

// Ambil tanggal registrasi domain via RDAP publik, lalu hitung usia (hari).
async function fetchDomainAge(domain) {
  try {
    const resp = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
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
