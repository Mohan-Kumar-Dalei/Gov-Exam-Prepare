/**
 * Gives every existing API key an owner.
 *
 *   npm run backfill-key-owners             # dry run — reports, changes nothing
 *   npm run backfill-key-owners -- --apply  # writes
 *
 * API keys used to be a single shared ring behind an admin-only screen, so the
 * rows carry no `user`. Now each learner brings their own key and the ring is
 * read scoped by owner, which means an ownerless row is invisible to everyone
 * and would look to its owner as though their key had vanished.
 *
 * `addedBy` already records who added each key, so that is the owner. A row
 * with neither is reported rather than guessed at: assigning someone else's
 * key to an account would let that account spend credits that are not theirs.
 *
 * The same safety rules as the other migration apply — dry run by default, and
 * a missing MONGO_URI is a hard stop rather than a fallback to a local
 * database, because a migration that guesses its database rewrites the wrong
 * one.
 */
const { loadEnv } = require('../config/loadEnv.js');

const envFile = loadEnv();

const mongoose = require('mongoose');
const { ApiKey, User } = require('../models/index.js');
const logger = require('../utils/logger.js');

const APPLY = process.argv.includes('--apply');

async function run() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    logger.error(
      'MONGO_URI is not set, so there is no way to know which database to migrate. ' +
        `Checked ${envFile || 'no .env file'}. Set it and run again — this script will not guess.`,
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  logger.info(`Connected to ${mongoose.connection.name} — ${APPLY ? 'APPLYING CHANGES' : 'DRY RUN'}`);

  // `user` is required on the schema now, so query the raw collection: a
  // strict model query would filter out exactly the rows that need fixing.
  const rows = await mongoose.connection
    .collection('apikeys')
    .find({ user: { $exists: false } })
    .toArray();

  if (!rows.length) {
    logger.info('Every API key already has an owner. Nothing to do.');
    await mongoose.connection.close();
    return;
  }

  logger.info(`${rows.length} key(s) without an owner\n`);

  let fixed = 0;
  let orphaned = 0;

  for (const row of rows) {
    if (!row.addedBy) {
      logger.warn(
        `  "${row.label}" (${row.masked}) has no addedBy, so its owner is unknown — left alone. ` +
          'Delete it and re-add the key under the account that should own it.',
      );
      orphaned += 1;
      continue;
    }

    const owner = await User.findById(row.addedBy).select('email').lean();
    if (!owner) {
      logger.warn(`  "${row.label}" was added by an account that no longer exists — left alone.`);
      orphaned += 1;
      continue;
    }

    logger.info(`  "${row.label}" (${row.masked}) -> ${owner.email}`);
    fixed += 1;
    if (!APPLY) continue;

    await mongoose.connection
      .collection('apikeys')
      .updateOne({ _id: row._id }, { $set: { user: row.addedBy } });
  }

  logger.info('');
  logger.info(`keys given an owner : ${fixed}`);
  logger.info(`keys left alone     : ${orphaned} (owner could not be determined)`);

  if (!APPLY && fixed) {
    logger.info('');
    logger.info(`DRY RUN — nothing was written. Re-run with --apply to make these ${fixed} change(s).`);
  }

  await mongoose.connection.close();
}

run().catch(async (err) => {
  logger.error('backfill-key-owners failed', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
