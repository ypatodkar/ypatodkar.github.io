import { EmailMessage } from 'cloudflare:email';

const RETENTION_DAYS = 90;
const CONTACT_FROM = 'contact@ypatodkar.com';
const CONTACT_TO = 'patodkaryash@gmail.com';   // must also be the send_email binding's destination
const CONTACT_PER_HOUR = 5;                     // per IP
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
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
    if (url.pathname === '/api/contact') return handleContact(request, env);

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

// Contact form: save every message, then email it with Reply-To set to the sender
async function handleContact(request, env) {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405 });

  const origin = request.headers.get('Origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }
  if (Number(request.headers.get('Content-Length') || 0) > 20000) {
    return Response.json({ error: 'Message is too long.' }, { status: 413 });
  }

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request.' }, { status: 400 }); }
  const name    = String(body.name ?? '').trim();
  const email   = String(body.email ?? '').trim();
  const message = String(body.message ?? '').trim();

  // Honeypot: real visitors never see this field, so pretend success to bots
  if (String(body.website ?? '').trim()) return Response.json({ ok: true });

  if (!name || name.length > 100) return Response.json({ error: 'Please enter your name.' }, { status: 400 });
  if (!EMAIL_RE.test(email) || email.length > 200) return Response.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  if (!message || message.length > 5000) return Response.json({ error: 'Please enter a message (up to 5,000 characters).' }, { status: 400 });

  const ip = request.headers.get('CF-Connecting-IP');
  const { recent } = await env.DB.prepare(
    `SELECT COUNT(*) AS recent FROM messages WHERE ip = ? AND ts > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`
  ).bind(ip).first();
  if (recent >= CONTACT_PER_HOUR) {
    return Response.json({ error: 'Too many messages — please try again in an hour.' }, { status: 429 });
  }

  const cf = request.cf || {};
  const { id } = await env.DB.prepare(
    `INSERT INTO messages (name, email, message, ip, org, city, region, country, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).bind(
    name, email, message, ip,
    cf.asOrganization || null, cf.city || null, cf.region || null, cf.country || null,
    request.headers.get('User-Agent'),
  ).first();

  try {
    const where = [cf.city, cf.region, cf.country].filter(Boolean).join(', ');
    await env.CONTACT_EMAIL.send(new EmailMessage(CONTACT_FROM, CONTACT_TO, contactEmail({ name, email, message, where })));
    await env.DB.prepare(`UPDATE messages SET sent = 1 WHERE id = ?`).bind(id).run();
  } catch (err) {
    // The message is saved and shows on /logs even when email delivery fails
    console.error('contact email failed', err);
    await env.DB.prepare(`UPDATE messages SET error = ? WHERE id = ?`).bind(String(err?.message || err), id).run();
  }

  return Response.json({ ok: true });
}

function contactEmail({ name, email, message, where }) {
  const body = `${message}\n\n— ${name} <${email}>${where ? `\n${where}` : ''}\nSent from the contact form on ypatodkar.com. Reply to this email to answer them.`;
  return [
    `From: "ypatodkar.com" <${CONTACT_FROM}>`,
    `To: <${CONTACT_TO}>`,
    `Reply-To: ${mimeWord(name)} <${email}>`,
    `Subject: ${mimeWord(`Portfolio message from ${name}`)}`,
    `Message-ID: <${crypto.randomUUID()}@ypatodkar.com>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(body).replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
}

// RFC 2047 encoded-word, so names and subjects can hold any character without breaking headers
function mimeWord(text) {
  return `=?UTF-8?B?${base64(text)}?=`;
}

function base64(text) {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
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

  const { results: messages } = await env.DB.prepare(`SELECT * FROM messages ORDER BY id DESC LIMIT 50`).all();
  const msgRows = messages.map(m => `<tr>
    <td>${esc(m.ts.replace('T', ' ').slice(0, 19))}</td>
    <td>${esc(m.name)}<br><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></td>
    <td class="msg">${esc(m.message)}</td>
    <td>${esc([m.city, m.country].filter(Boolean).join(', '))}<br>${esc(m.org)}</td>
    <td>${m.sent ? 'emailed' : `<span class="err">not emailed</span> ${esc(m.error)}`}</td>
  </tr>`).join('');

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
  td.msg{white-space:pre-wrap;max-width:520px;overflow-wrap:anywhere}
  .err{color:#b00020;font-weight:600}
  .wrap{overflow-x:auto}
</style>
<h1>Messages <small>(${messages.length})</small></h1>
<div class="wrap"><table><tr><th>ts</th><th>from</th><th>message</th><th>where</th><th>status</th></tr>${msgRows || '<tr><td colspan="5">No messages yet.</td></tr>'}</table></div>
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
