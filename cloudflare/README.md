# DeFacto Cafe على Cloudflare Workers

نفس الموقع ولوحة الأدمن، بس بدون نوم وببيانات دائمة (KV).

- `src/worker.js` — نفس API الخاص بـ server.js (منيو، إعلان، رفع صور، طلبات)
- `build.mjs` — بينسخ الملفات الثابتة من المجلد الرئيسي لـ `public/`
- `wrangler.toml` — إعدادات النشر (رقم الـ KV بينحط وقت النشر)

## تجربة محلية
    cd cloudflare && npm install && npm run dev

## نشر
    set CLOUDFLARE_API_TOKEN=...   (و CLOUDFLARE_ACCOUNT_ID لو لزم)
    npm run deploy
