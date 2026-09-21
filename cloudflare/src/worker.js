/*
  نسخة Cloudflare Workers من server.js — نفس الـ API بالضبط، لكن:
  - الملفات الثابتة (HTML/الصور) بتجي من env.ASSETS
  - البيانات (المنيو، الإعلان، الطلبات، الصور المرفوعة من الأدمن) بتنحفظ بـ KV (env.DATA)
    فبتضل دائمة ومابتنمسح مع النشر
  - كلمة السر من السر ADMIN_PASSWORD (أو الافتراضية)
*/

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const CORS = { 'Access-Control-Allow-Origin': '*' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...CORS } });

/* ── تنظيف الحقول الإنجليزية من تشكيل عربي/محارف اتجاه خفية (نفس server.js) ── */
function cleanEnglishText(s) {
  return typeof s === 'string'
    ? s.replace(/[ً-ٰٟ]/g, '').replace(/[​-‏‪-‮⁦-⁩]/g, '').trim()
    : s;
}
function sanitizeMenu(sections) {
  return sections.map(sec => ({
    ...sec,
    items: (sec.items || []).map(it => ({ ...it, en: cleanEnglishText(it.en), dEn: cleanEnglishText(it.dEn) }))
  }));
}
function sanitizePromo(promo) {
  const clean = { ...promo };
  if (Array.isArray(clean.slides)) {
    clean.slides = clean.slides.map(sl => ({ ...sl, titleEn: cleanEnglishText(sl.titleEn), subEn: cleanEnglishText(sl.subEn) }));
  }
  if (clean.titleEn !== undefined) clean.titleEn = cleanEnglishText(clean.titleEn);
  if (clean.subEn !== undefined) clean.subEn = cleanEnglishText(clean.subEn);
  return clean;
}

const isAdmin = (request, env) => request.headers.get('x-admin-password') === (env.ADMIN_PASSWORD || 'defacto2026');

/* ── قراءة ملف بيانات: من KV، وإذا فاضي من النسخة الأولية المرفقة مع الموقع ── */
async function readData(env, request, kvKey, assetPath) {
  const stored = await env.DATA.get(kvKey);
  if (stored !== null) return stored;
  const res = await env.ASSETS.fetch(new Request(new URL(assetPath, request.url)));
  return res.ok ? await res.text() : null;
}

/* ── حفظ مع نسخة احتياطية للنسخة السابقة ── */
async function writeData(env, kvKey, text) {
  const previous = await env.DATA.get(kvKey);
  if (previous !== null) await env.DATA.put(kvKey + ':backup', previous);
  await env.DATA.put(kvKey, text);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password' }
      });
    }

    /* ── تسجيل الدخول ── */
    if (path === '/api/login' && method === 'POST') {
      try {
        const body = await request.json();
        const ok = body.password === (env.ADMIN_PASSWORD || 'defacto2026');
        return json(ok ? 200 : 401, { ok });
      } catch {
        return json(400, { ok: false, error: 'bad request' });
      }
    }

    /* ── المنيو ── */
    if ((path === '/api/menu' || path === '/menu-data.json') && method === 'GET') {
      const data = await readData(env, request, 'menu', '/menu-data.json');
      if (data === null) return json(404, { error: 'not found' });
      return new Response(data, { headers: { ...JSON_HEADERS, ...CORS } });
    }
    if (path === '/api/menu' && method === 'POST') {
      if (!isAdmin(request, env)) return json(401, { ok: false, error: 'unauthorized' });
      try {
        const parsed = await request.json();
        if (!Array.isArray(parsed)) throw new Error('expected an array of sections');
        await writeData(env, 'menu', JSON.stringify(sanitizeMenu(parsed), null, 2));
        return json(200, { ok: true });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }

    /* ── البانر الإعلاني ── */
    if ((path === '/api/promo' || path === '/promo-data.json') && method === 'GET') {
      const data = await readData(env, request, 'promo', '/promo-data.json');
      if (data === null) return json(404, { error: 'not found' });
      return new Response(data, { headers: { ...JSON_HEADERS, ...CORS } });
    }
    if (path === '/api/promo' && method === 'POST') {
      if (!isAdmin(request, env)) return json(401, { ok: false, error: 'unauthorized' });
      try {
        const parsed = await request.json();
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a promo object');
        await writeData(env, 'promo', JSON.stringify(sanitizePromo(parsed), null, 2));
        return json(200, { ok: true });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }

    /* ── رفع صورة من لوحة الأدمن ── */
    if (path === '/api/upload-image' && method === 'POST') {
      if (!isAdmin(request, env)) return json(401, { ok: false, error: 'unauthorized' });
      try {
        const body = await request.json();
        const match = String(body.dataBase64 || '').match(/^data:image\/(png|jpe?g|webp);base64,([\s\S]+)$/i);
        if (!match) throw new Error('صيغة صورة غير مدعومة (استخدمي JPG أو PNG أو WEBP)');
        const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
        const bytes = base64ToBytes(match[2]);
        if (bytes.length > MAX_IMAGE_BYTES) throw new Error('الصورة كبيرة كتير (الحد الأقصى 4 ميغا)');
        const filename = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
        const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
        await env.DATA.put('img:' + filename, bytes, { metadata: { type } });
        return json(200, { ok: true, filename });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }

    /* ── الصور المرفوعة من الأدمن (item-*.jpg/png/webp) ── */
    const imgMatch = path.match(/^\/(item-[A-Za-z0-9-]+\.(?:png|jpg|webp))$/);
    if (imgMatch && method === 'GET') {
      const { value, metadata } = await env.DATA.getWithMetadata('img:' + imgMatch[1], 'arrayBuffer');
      if (value) {
        return new Response(value, {
          headers: { 'Content-Type': (metadata && metadata.type) || 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable', ...CORS }
        });
      }
      // ما لقيناها بـ KV — جرّبي الملفات الثابتة (بتنتهي بـ 404 إذا مو موجودة)
    }

    /* ── طلبات الطاولات ── */
    if (path === '/api/orders' && method === 'POST') {
      try {
        const body = await request.json();
        const table = String(body.table || '').trim();
        const itemAr = String(body.itemAr || '').trim();
        if (!table || !itemAr) throw new Error('missing table or item');
        const order = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          table,
          itemAr,
          itemEn: String(body.itemEn || '').trim(),
          sizeAr: body.sizeAr ? String(body.sizeAr).trim() : '',
          sizeEn: body.sizeEn ? String(body.sizeEn).trim() : '',
          note: body.note ? String(body.note).trim().slice(0, 200) : '',
          price: Number(body.price) || 0,
          createdAt: Date.now(),
          status: 'new'
        };
        const orders = JSON.parse((await env.DATA.get('orders')) || '[]');
        orders.push(order);
        await env.DATA.put('orders', JSON.stringify(orders));
        return json(200, { ok: true, order });
      } catch (e) {
        return json(400, { ok: false, error: e.message });
      }
    }
    if (path === '/api/orders' && method === 'GET') {
      if (!isAdmin(request, env)) return json(401, { ok: false, error: 'unauthorized' });
      const status = url.searchParams.get('status');
      let orders = JSON.parse((await env.DATA.get('orders')) || '[]');
      if (status) orders = orders.filter(o => o.status === status);
      orders.sort((a, b) => a.createdAt - b.createdAt);
      return json(200, orders);
    }
    const doneMatch = path.match(/^\/api\/orders\/([^/]+)\/done$/);
    if (doneMatch && method === 'POST') {
      if (!isAdmin(request, env)) return json(401, { ok: false, error: 'unauthorized' });
      const orders = JSON.parse((await env.DATA.get('orders')) || '[]');
      const order = orders.find(o => o.id === doneMatch[1]);
      if (!order) return json(404, { ok: false, error: 'not found' });
      order.status = 'done';
      order.doneAt = Date.now();
      await env.DATA.put('orders', JSON.stringify(orders));
      return json(200, { ok: true });
    }

    /* ── أي شي تاني: ملفات ثابتة ── */
    if (path.startsWith('/api/')) return json(404, { ok: false, error: 'not found' });
    return env.ASSETS.fetch(request);
  }
};
