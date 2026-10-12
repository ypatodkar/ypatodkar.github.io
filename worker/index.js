const RETENTION_DAYS = 90;
const BOT_UA = /bot|crawl|spider|slurp|preview|fetch|monitor|curl|wget|python|headless|lighthouse|facebookexternalhit|embedly|whatsapp|telegram|discord|slack/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.hostname === 'www.ypatodkar.com' || url.protocol === 'http:') {
      url.hostname = 'ypatodkar.com';
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === '/logs') return logsPage(request, env);

    if (shouldLog(request, url)) ctx.waitUntil(logVisit(request, url, env));

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env) {
    await env.DB.prepare(`DELETE FROM visits WHERE ts < datetime('now', ?)`)
      .bind(`-${RETENTION_DAYS} days`)
      .run();
  },
};

// Only page loads and the resume download — not every CSS/JS/image request.
function shouldLog(request, url) {
  if (request.method !== 'GET') return false;
  if (url.pathname.toLowerCase().endsWith('.pdf')) return true;
  return request.headers.get('Sec-Fetch-Dest') === 'document'
    || (request.headers.get('Accept') || '').includes('text/html');
}

async function logVisit(request, url, env) {
  const cf = request.cf || {};
  const ua = request.headers.get('User-Agent') || '';
  try {
    await env.DB.prepare(
      `INSERT INTO visits (path, ref, referer, ip, org, asn, city, region, country, timezone, user_agent, language, is_bot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      decodeURIComponent(url.pathname),
      url.searchParams.get('ref') || url.searchParams.get('utm_source'),
      request.headers.get('Referer'),
      request.headers.get('CF-Connecting-IP'),
      cf.asOrganization || null,
      cf.asn || null,
      cf.city || null,
      cf.region || null,
      cf.country || null,
      cf.timezone || null,
      ua,
      (request.headers.get('Accept-Language') || '').split(',')[0] || null,
      BOT_UA.test(ua) ? 1 : 0,
    ).run();
  } catch (err) {
    console.error('visit log failed', err);
  }
}

async function logsPage(request, env) {
  if (!authorized(request, env)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="logs"' },
    });
  }

  const url = new URL(request.url);
  const showBots = url.searchParams.has('bots');
  const { results } = await env.DB.prepare(
    `SELECT * FROM visits ${showBots ? '' : 'WHERE is_bot = 0'} ORDER BY id DESC LIMIT 500`
  ).all();

  if (url.searchParams.has('json')) return Response.json(results);

  const cols = ['ts', 'path', 'ref', 'org', 'city', 'region', 'country', 'referer', 'ip', 'user_agent'];
  const rows = results.map(r =>
    `<tr>${cols.map(c => `<td>${esc(c === 'ts' ? r.ts.replace('T', ' ').slice(0, 19) : r[c])}</td>`).join('')}</tr>`
  ).join('');

  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visits</title>
<style>
  body{font:13px/1.4 system-ui,sans-serif;margin:16px;background:#fff;color:#111}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
  th{position:sticky;top:0;background:#f6f6f6}
  td:last-child{max-width:320px;overflow-wrap:anywhere;color:#666}
  .wrap{overflow-x:auto}
</style>
<h1>Visits <small>(${results.length}${showBots ? ', incl. bots' : ''})</small></h1>
<p><a href="?${showBots ? '' : 'bots'}">${showBots ? 'Hide' : 'Show'} bots</a> · <a href="?json">JSON</a></p>
<div class="wrap"><table><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${rows}</table></div>`, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!env.LOGS_PASSWORD || !header.startsWith('Basic ')) return false;
  const [, password] = atob(header.slice(6)).split(':');
  return password === env.LOGS_PASSWORD;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
