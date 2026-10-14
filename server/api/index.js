// StarShare global API — players post their final images, everyone can browse, like, comment and
// buy prints (paid in in-game money, credited to the author). Postgres via Neon's serverless driver.
import { neon } from '@neondatabase/serverless';
import crypto from 'node:crypto';

const sql = neon(process.env.DATABASE_URL);
let migrated = null;
function migrate() {
  return (migrated ||= (async () => {
    await sql`create extension if not exists pgcrypto`;
    await sql`create table if not exists players (id uuid primary key default gen_random_uuid(), name text not null, token_hash text unique not null, ip_hash text, created timestamptz default now())`;
    await sql`create table if not exists posts (id uuid primary key default gen_random_uuid(), player_id uuid references players(id) on delete cascade, title text not null, target text, image bytea not null, thumb bytea not null, score int, meta jsonb, likes int default 0, comments int default 0, prints int default 0, reports int default 0, hidden boolean default false, created timestamptz default now())`;
    await sql`create index if not exists posts_created on posts (created desc)`;
    await sql`create table if not exists likes (post_id uuid references posts(id) on delete cascade, player_id uuid references players(id) on delete cascade, created timestamptz default now(), primary key (post_id, player_id))`;
    await sql`create table if not exists comments (id bigserial primary key, post_id uuid references posts(id) on delete cascade, player_id uuid references players(id) on delete cascade, text text not null, created timestamptz default now())`;
    await sql`create table if not exists prints (id bigserial primary key, post_id uuid references posts(id) on delete cascade, buyer_id uuid references players(id) on delete cascade, size text not null, price int not null, created timestamptz default now(), unique (post_id, buyer_id, size))`;
    await sql`create table if not exists reports (post_id uuid references posts(id) on delete cascade, player_id uuid references players(id) on delete cascade, primary key (post_id, player_id))`;
    await sql`create table if not exists like_credits (post_id uuid references posts(id) on delete cascade, player_id uuid references players(id) on delete cascade, primary key (post_id, player_id))`;
    await sql`create table if not exists ledger (id bigserial primary key, player_id uuid references players(id) on delete cascade, amount int not null, reason text, claimed boolean default false, created timestamptz default now())`;
  })().catch((e) => { migrated = null; throw e; }));
}

const PRINT_SIZES = { '8x10': 40, '16x20': 90, '24x36': 180 };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => { throw new HttpError(code, msg); };

function ipHash(req) { return sha((String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown') + ':fl'); }
async function auth(req) {
  const h = String(req.headers.authorization || ''); const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!tok) bad('Not signed in', 401);
  const rows = await sql`select id, name from players where token_hash = ${sha(tok)}`;
  if (!rows.length) bad('Unknown player', 401);
  return rows[0];
}
function jpeg(b64, max, what) {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(b64 || '')); if (!m) bad(`${what} must be a JPEG`);
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > max) bad(`${what} too large`); if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) bad(`${what} is not a JPEG`);
  return buf;
}
const postRow = (p) => ({ id: p.id, title: p.title, target: p.target, author: p.author, authorId: p.player_id, score: p.score, meta: p.meta, likes: p.likes, comments: p.comments, prints: p.prints, created: p.created, liked: !!p.liked });

async function route(req, res, path) {
  const method = req.method;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // --- images (cacheable) ---
  let m;
  if (method === 'GET' && (m = /^\/(image|thumb)\/([0-9a-f-]{36})$/.exec(path))) {
    const rows = m[1] === 'image' ? await sql`select image as b from posts where id = ${m[2]} and not hidden` : await sql`select thumb as b from posts where id = ${m[2]} and not hidden`;
    if (!rows.length) bad('Not found', 404);
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    const v = rows[0].b; const buf = typeof v === 'string' ? Buffer.from(v.replace(/^\\x/, ''), 'hex') : Buffer.from(v);
    return res.status(200).send(buf);
  }
  if (method === 'GET' && path === '/health') return { ok: true };
  if (method === 'POST' && path === '/register') {
    const name = clean(body.name, 24) || 'Observer'; const ip = ipHash(req);
    const recent = await sql`select count(*)::int as n from players where ip_hash = ${ip} and created > now() - interval '1 hour'`;
    if (recent[0].n >= 5) bad('Too many new players from this network — try again later', 429);
    const token = crypto.randomBytes(32).toString('base64url');
    const rows = await sql`insert into players (name, token_hash, ip_hash) values (${name}, ${sha(token)}, ${ip}) returning id, name`;
    return { id: rows[0].id, name: rows[0].name, token };
  }
  if (method === 'GET' && path === '/posts') {
    const q = req.query || {}; const sort = q.sort === 'top' ? 'top' : 'new'; const limit = Math.min(48, Math.max(1, +q.limit || 24)); const before = q.before ? new Date(q.before) : null;
    let me = null; try { me = req.headers.authorization ? await auth(req) : null; } catch { me = null; }
    const mid = me ? me.id : '00000000-0000-0000-0000-000000000000';
    const rows = sort === 'top'
      ? await sql`select p.id, p.title, p.target, p.player_id, p.score, p.meta, p.likes, p.comments, p.prints, p.created, pl.name as author, exists(select 1 from likes l where l.post_id = p.id and l.player_id = ${mid}) as liked from posts p join players pl on pl.id = p.player_id where not p.hidden and p.created > now() - interval '30 days' order by p.likes desc, p.created desc limit ${limit}`
      : await sql`select p.id, p.title, p.target, p.player_id, p.score, p.meta, p.likes, p.comments, p.prints, p.created, pl.name as author, exists(select 1 from likes l where l.post_id = p.id and l.player_id = ${mid}) as liked from posts p join players pl on pl.id = p.player_id where not p.hidden and (${before}::timestamptz is null or p.created < ${before}) order by p.created desc limit ${limit}`;
    return { posts: rows.map(postRow) };
  }
  if (method === 'POST' && path === '/posts') {
    const me = await auth(req);
    const n = await sql`select count(*)::int as n from posts where player_id = ${me.id} and created > now() - interval '1 day'`;
    if (n[0].n >= 12) bad('Daily posting limit reached (12)', 429);
    const image = jpeg(body.image, 1_600_000, 'Image'), thumb = jpeg(body.thumb, 120_000, 'Thumbnail');
    const meta = body.meta && typeof body.meta === 'object' ? JSON.parse(JSON.stringify(body.meta).slice(0, 4000)) : {};
    const rows = await sql`insert into posts (player_id, title, target, image, thumb, score, meta) values (${me.id}, ${clean(body.title, 80) || 'Untitled'}, ${clean(body.target, 60)}, ${image}, ${thumb}, ${Math.max(0, Math.min(100, +body.score || 0))}, ${meta}) returning id, created`;
    return { id: rows[0].id, created: rows[0].created };
  }
  if ((m = /^\/posts\/([0-9a-f-]{36})(?:\/(like|comment|print|report|delete))?$/.exec(path))) {
    const id = m[1], action = m[2];
    if (method === 'GET' && !action) {
      let me = null; try { me = req.headers.authorization ? await auth(req) : null; } catch { me = null; }
      const mid = me ? me.id : '00000000-0000-0000-0000-000000000000';
      const p = await sql`select p.id, p.title, p.target, p.player_id, p.score, p.meta, p.likes, p.comments, p.prints, p.created, pl.name as author, exists(select 1 from likes l where l.post_id = p.id and l.player_id = ${mid}) as liked from posts p join players pl on pl.id = p.player_id where p.id = ${id} and not p.hidden`;
      if (!p.length) bad('Not found', 404);
      const c = await sql`select c.id, c.text, c.created, pl.name as author from comments c join players pl on pl.id = c.player_id where c.post_id = ${id} order by c.created asc limit 200`;
      const bought = me ? await sql`select size from prints where post_id = ${id} and buyer_id = ${me.id}` : [];
      return { post: postRow(p[0]), comments: c, bought: bought.map((b) => b.size), printSizes: PRINT_SIZES };
    }
    if (method !== 'POST') bad('Method not allowed', 405);
    const me = await auth(req);
    const post = await sql`select id, player_id, title from posts where id = ${id} and not hidden`;
    if (!post.length) bad('Not found', 404);
    const author = post[0].player_id;
    if (action === 'like') {
      const own = author === me.id;
      const ins = await sql`insert into likes (post_id, player_id) values (${id}, ${me.id}) on conflict do nothing returning post_id`;
      if (ins.length) {
        await sql`update posts set likes = likes + 1 where id = ${id}`;
        // pay the author once per liker (un-liking and re-liking doesn't farm money)
        const first = own ? [] : await sql`insert into like_credits (post_id, player_id) values (${id}, ${me.id}) on conflict do nothing returning post_id`;
        if (first.length) await sql`insert into ledger (player_id, amount, reason) values (${author}, 3, ${'Like on “' + post[0].title + '”'})`;
        return { liked: true };
      }
      await sql`delete from likes where post_id = ${id} and player_id = ${me.id}`;
      await sql`update posts set likes = greatest(0, likes - 1) where id = ${id}`;
      return { liked: false };
    }
    if (action === 'comment') {
      const text = clean(body.text, 280); if (!text) bad('Empty comment');
      const n = await sql`select count(*)::int as n from comments where player_id = ${me.id} and created > now() - interval '1 hour'`;
      if (n[0].n >= 40) bad('Slow down a little', 429);
      const rows = await sql`insert into comments (post_id, player_id, text) values (${id}, ${me.id}, ${text}) returning id, created`;
      await sql`update posts set comments = comments + 1 where id = ${id}`;
      return { id: rows[0].id, created: rows[0].created, text, author: me.name };
    }
    if (action === 'print') {
      const size = String(body.size); const price = PRINT_SIZES[size]; if (!price) bad('Unknown print size');
      if (author === me.id) bad('You can’t buy prints of your own image');
      const ins = await sql`insert into prints (post_id, buyer_id, size, price) values (${id}, ${me.id}, ${size}, ${price}) on conflict do nothing returning id`;
      if (!ins.length) bad('You already own this print');
      await sql`update posts set prints = prints + 1 where id = ${id}`;
      await sql`insert into ledger (player_id, amount, reason) values (${author}, ${Math.round(price * 0.6)}, ${size + ' print of “' + post[0].title + '” sold'})`;
      return { ok: true, price };
    }
    if (action === 'delete') {
      if (author !== me.id) bad('Only the author can delete a post', 403);
      await sql`delete from posts where id = ${id}`;
      return { ok: true };
    }
    if (action === 'report') {
      const ins = await sql`insert into reports (post_id, player_id) values (${id}, ${me.id}) on conflict do nothing returning post_id`;
      if (ins.length) await sql`update posts set reports = reports + 1, hidden = (reports + 1 >= 3) where id = ${id}`;
      return { ok: true };
    }
  }
  if (method === 'GET' && path === '/me') {
    const me = await auth(req);
    const u = await sql`select coalesce(sum(amount), 0)::int as total from ledger where player_id = ${me.id} and not claimed`;
    const recent = await sql`select amount, reason, created from ledger where player_id = ${me.id} and not claimed order by created desc limit 20`;
    const posts = await sql`select count(*)::int as n, coalesce(sum(likes), 0)::int as likes from posts where player_id = ${me.id}`;
    return { id: me.id, name: me.name, unclaimed: u[0].total, recent, posts: posts[0].n, likes: posts[0].likes };
  }
  if (method === 'POST' && path === '/claim') {
    const me = await auth(req);
    const rows = await sql`update ledger set claimed = true where player_id = ${me.id} and not claimed returning amount, reason`;
    return { amount: rows.reduce((a, r) => a + r.amount, 0), items: rows };
  }
  if (method === 'POST' && path === '/rename') {
    const me = await auth(req); const name = clean(body.name, 24); if (!name) bad('Empty name');
    await sql`update players set name = ${name} where id = ${me.id}`; return { name };
  }
  bad('Not found', 404);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const path = (String(req.url || '').split('?')[0].replace(/^\/api/, '') || '/').replace(/\/+$/, '') || '/';
  try {
    await migrate();
    const out = await route(req, res, path);
    if (out !== undefined && !res.headersSent) res.status(200).json(out);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.code).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
}
