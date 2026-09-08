/**
 * One-off / repeatable import of the BROADER MENU workbook into `broader_menu`.
 *
 * Runs the SAME controller the Expense page's upload button calls, so this is
 * the CLI door onto exactly the behaviour the UI has — no second parser to
 * drift out of sync.
 *
 *   npx ts-node scripts/import-broader-menu.ts "../BROADER MENU-....xlsx"
 *
 * Rows are keyed on MC CD: existing codes are updated, new ones inserted,
 * nothing is ever deleted.
 */

import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { uploadBroaderMenu } from '../src/controllers/adminController';

const DEFAULT_FILE = path.resolve(
  __dirname,
  '../../BROADER MENU-2025-01-22-H(2007)-07.02.2025.-FINAL-OK.xlsx'
);

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;

  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  console.log(`Importing ${path.basename(file)} ...`);

  const req: any = { file: { buffer: fs.readFileSync(file), originalname: path.basename(file) } };

  let status = 200;
  const res: any = {
    status(code: number) { status = code; return res; },
    json(body: any) {
      console.log(`\nHTTP ${status}`);
      console.log(JSON.stringify(body, null, 2));
      return res;
    },
  };

  await uploadBroaderMenu(req, res);
  process.exit(status >= 400 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
