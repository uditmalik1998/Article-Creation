const { PrismaClient } = require('./src/generated/prisma');
const ALT = 'postgresql://postgres.hgdftqswlvkspzjtlrll:r9vnBBtlUaduEwAS@aws-1-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require';
function classify(msg) {
  const m = msg.toLowerCase();
  if (m.includes('password authentication failed') || m.includes('p1000')) return 'WRONG_PASSWORD';
  if (m.includes('ecircuitbreaker') || m.includes('too many authentication')) return 'CIRCUIT_OPEN';
  if (m.includes("can't reach") || m.includes('p1001') || m.includes('timed out')) return 'UNREACHABLE';
  if (m.includes('tenant or user not found')) return 'BAD_USERNAME';
  return 'OTHER';
}
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 1; i <= 12; i++) {
    const p = new PrismaClient({ datasources: { db: { url: ALT } } });
    try {
      await p.$queryRaw`select 1 as ok`;
      console.log(`attempt ${i}: AUTH_OK — alternative password is CORRECT`);
      await p.$disconnect(); process.exit(0);
    } catch (e) {
      const raw = String(e.message).replace(/\s+/g,' ').trim();
      const c = classify(raw);
      const detail = (c === 'OTHER') ? ' :: ' + raw.slice(-160) : '';
      console.log(`attempt ${i}: ${c}${detail}`);
      await p.$disconnect().catch(()=>{});
      if (c === 'WRONG_PASSWORD') { console.log('=> ALT also wrong; need dashboard password.'); process.exit(2); }
      if (c === 'BAD_USERNAME') { console.log('=> username/project-ref wrong.'); process.exit(2); }
    }
    if (i < 12) await wait(25000);
  }
})();
