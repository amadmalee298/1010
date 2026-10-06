'use strict';
const http = require('node:http');
const path = require('node:path');
const { open } = require('./db');
const { createApi } = require('./api');
const { send, serveStatic, readBody } = require('./http');

function createServer(db) {
  const router = createApi(db);
  const publicDir = path.join(__dirname, '..', 'public');

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(publicDir, req, res, url.pathname);

    const match = router.match(req.method, url.pathname);
    if (!match) return send(res, 404, { error: 'ไม่พบ API' });

    const ctx = { req, res, db, params: match.params, query: Object.fromEntries(url.searchParams), body: {}, user: null };
    try {
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) ctx.body = await readBody(req);
      let result;
      for (const h of match.handlers) {
        result = await h(ctx);
        if (res.writableEnded) return;
      }
      send(res, 200, result === undefined ? { ok: true } : result);
    } catch (err) {
      const duplicate = /UNIQUE constraint/.test(err.message);
      const status = duplicate ? 409 : err.status || 500;
      if (status >= 500) console.error(err);
      const message = duplicate ? 'ข้อมูลซ้ำกับที่มีอยู่แล้ว' : status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message;
      if (!res.writableEnded) send(res, status, { error: message });
    }
  });
}

module.exports = { createServer };

if (require.main === module) {
  const db = open();
  const port = Number(process.env.PORT || 3000);
  createServer(db).listen(port, () => {
    console.log(`🍮 Custard POS พร้อมใช้งานที่ http://localhost:${port}`);
    console.log('   PIN เริ่มต้น: เจ้าของร้าน 1234 | ผู้จัดการ 2222 | แคชเชียร์ 1111 | ครัว 3333');
  });
}
