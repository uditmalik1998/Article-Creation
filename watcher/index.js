require('dotenv').config();

const cron = require('node-cron');
const { CRON_SCHEDULES } = require('./config');
const { load: loadProcessed } = require('./processedTracker');
const { runScan } = require('./scanner');
const log = require('./logger');

// --test flag: run one scan immediately and exit (for manual testing)
const testMode = process.argv.includes('--test');

// NOTE: The scheduled SRM pull (runSrmSync → POST /api/watcher/sync-srm) has been
// removed. SRM presentations are ingested via the external SRM writer →
// raw_articles table → the backend's raw-articles extraction cron. This watcher
// now only scans the image folder.

async function main() {
  log.info('AI Fashion Watcher Service starting...');
  log.info(`Schedules: 12:00 PM, 8:00 PM (daily)`);

  // Load list of already-processed images
  loadProcessed();

  if (testMode) {
    log.info('[TEST MODE] Running one scan now and exiting...');
    await runScan();
    process.exit(0);
    return;
  }

  // Schedule scans at 12pm, 8pm — DISABLED
  // CRON_SCHEDULES.forEach((schedule, i) => {
  //   const labels = ['12:00 PM', '8:00 PM'];
  //   cron.schedule(schedule, async () => {
  //     log.info(`Scheduled scan triggered: ${labels[i]}`);
  //     try {
  //       await runScan();
  //     } catch (err) {
  //       log.error('Unexpected error during image scan:', err.message);
  //     }
  //   });
  //   log.info(`Scheduled: ${labels[i]} (cron: ${schedule})`);
  // });

  log.info('Watcher cron jobs disabled. Exiting.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
