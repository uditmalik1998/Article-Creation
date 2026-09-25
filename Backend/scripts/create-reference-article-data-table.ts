import { PrismaClient } from '../src/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const sqlPath = path.join(__dirname, '../prisma/migrations/create_reference_article_data.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Strip line comments, then split on semicolons
  const stripped = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    console.log('Running:', stmt.slice(0, 80).replace(/\n/g, ' '), '...');
    await prisma.$executeRawUnsafe(stmt);
  }

  console.log('\nreference_article_data table created successfully.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
