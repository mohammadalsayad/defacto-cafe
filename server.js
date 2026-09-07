/*
  سيرفر بسيط لتشغيل موقع المنيو + لوحة تحكم الأدمن على الشبكة المحلية.
  - يخدم كل الملفات الثابتة (HTML/CSS/JS/الصور) من نفس المجلد.
  - يوفر API صغير لحفظ/قراءة بيانات المنيو (menu-data.json) حتى تشتغل لوحة التحكم.

  التشغيل:  node server.js
  البورت الافتراضي: 8090 (متل ما كان مع python -m http.server)
*/

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
// على الاستضافة بيجي البورت من متغيّر بيئة، ومحليًا بيرجع 8090
const PORT = process.env.PORT || 8090;

// ── كلمة سر الأدمن: بتتحدد من متغيّر البيئة ADMIN_PASSWORD على الاستضافة ──
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'defacto2026';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 8 * 1024 * 1024) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // CORS preflight (غير ضروري عمليًا بما إنو كله نفس المصدر، بس بيحمي لو تغيّر شي)
  if (req.method === 'OPTIONS') {
    return send(res, 204, null, {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Admin-Password'
    });
  }

  // ── تسجيل الدخول: تتحقق من كلمة السر بس، ما في جلسات ──
  if (url.pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const ok = body.password === ADMIN_PASSWORD;
      return send(res, ok ? 200 : 401, JSON.stringify({ ok }), { 'Content-Type': 'application/json' });
    } catch {
      return send(res, 400, JSON.stringify({ ok: false, error: 'bad request' }), { 'Content-Type': 'application/json' });
    }
  }

  // ── قراءة بيانات المنيو ──
  if (url.pathname === '/api/menu' && req.method === 'GET') {
    try {
      const data = fs.readFileSync(path.join(ROOT, 'menu-data.json'), 'utf8');
      return send(res, 200, data, { 'Content-Type': 'application/json' });
    } catch {
      return send(res, 404, JSON.stringify({ error: 'not found' }), { 'Content-Type': 'application/json' });
    }
  }

  // ── حفظ بيانات المنيو (يتطلب كلمة السر بالهيدر) ──
  if (url.pathname === '/api/menu' && req.method === 'POST') {
    const pass = req.headers['x-admin-password'];
    if (pass !== ADMIN_PASSWORD) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'unauthorized' }), { 'Content-Type': 'application/json' });
    }
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed)) throw new Error('expected an array of sections');
      // نسخة احتياطية قبل الكتابة، تحسبًا لأي غلط
      const target = path.join(ROOT, 'menu-data.json');
      if (fs.existsSync(target)) fs.copyFileSync(target, path.join(ROOT, 'menu-data.backup.json'));
      fs.writeFileSync(target, JSON.stringify(parsed, null, 2), 'utf8');
      return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message }), { 'Content-Type': 'application/json' });
    }
  }

  // ── رفع صورة لصنف (من لوحة التحكم) — تتطلب كلمة السر ──
  if (url.pathname === '/api/upload-image' && req.method === 'POST') {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'unauthorized' }), { 'Content-Type': 'application/json' });
    }
    try {
      const body = JSON.parse(await readBody(req));
      const dataUrl = String(body.dataBase64 || '');
      const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,([\s\S]+)$/i);
      if (!match) throw new Error('صيغة صورة غير مدعومة (استخدمي JPG أو PNG أو WEBP)');
      const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > 4 * 1024 * 1024) throw new Error('الصورة كبيرة كتير (الحد الأقصى 4 ميغا)');
      const filename = `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      fs.writeFileSync(path.join(ROOT, filename), buffer);
      return send(res, 200, JSON.stringify({ ok: true, filename }), { 'Content-Type': 'application/json' });
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message }), { 'Content-Type': 'application/json' });
    }
  }

  // ── طلبات المطبخ ──
  const ORDERS_FILE = path.join(ROOT, 'orders.json');
  function readOrders() {
    try { return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8')); } catch { return []; }
  }
  function writeOrders(orders) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), 'utf8');
  }

  // الزبون بيرسل طلب — ما بيحتاج كلمة سر (أي حدا عالشبكة يقدر يطلب، هيك المفروض)
  if (url.pathname === '/api/orders' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
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
      const orders = readOrders();
      orders.push(order);
      writeOrders(orders);
      return send(res, 200, JSON.stringify({ ok: true, order }), { 'Content-Type': 'application/json' });
    } catch (e) {
      return send(res, 400, JSON.stringify({ ok: false, error: e.message }), { 'Content-Type': 'application/json' });
    }
  }

  // المطبخ بيقرا الطلبات — يتطلب كلمة السر
  if (url.pathname === '/api/orders' && req.method === 'GET') {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'unauthorized' }), { 'Content-Type': 'application/json' });
    }
    const status = url.searchParams.get('status');
    let orders = readOrders();
    if (status) orders = orders.filter(o => o.status === status);
    orders.sort((a, b) => a.createdAt - b.createdAt); // الأقدم أول (طابور FIFO)
    return send(res, 200, JSON.stringify(orders), { 'Content-Type': 'application/json' });
  }

  // تعليم طلب "تم تحضيره" — يتطلب كلمة السر
  const doneMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/done$/);
  if (doneMatch && req.method === 'POST') {
    if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
      return send(res, 401, JSON.stringify({ ok: false, error: 'unauthorized' }), { 'Content-Type': 'application/json' });
    }
    const orders = readOrders();
    const order = orders.find(o => o.id === doneMatch[1]);
    if (!order) return send(res, 404, JSON.stringify({ ok: false, error: 'not found' }), { 'Content-Type': 'application/json' });
    order.status = 'done';
    order.doneAt = Date.now();
    writeOrders(orders);
    return send(res, 200, JSON.stringify({ ok: true }), { 'Content-Type': 'application/json' });
  }

  // ── تقديم الملفات الثابتة (HTML/CSS/JS/الصور) ──
  let filePath = decodeURIComponent(url.pathname);
  if (filePath === '/') filePath = '/index.html';
  filePath = path.normalize(path.join(ROOT, filePath));

  // منع الخروج خارج مجلد المشروع
  if (!filePath.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      send(res, 404, 'Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    // ما نخلي المتصفح يخبّي نسخة قديمة من الصفحات — دايمًا آخر تحديث
    send(res, 200, content, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DeFacto Cafe server running on port ${PORT}`);
  console.log(`Admin panel -> /admin.html`);
});
