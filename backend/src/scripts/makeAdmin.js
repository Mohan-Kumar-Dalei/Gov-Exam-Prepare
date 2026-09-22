/**
 * Promotes an account to admin, which is what the API key ring requires.
 *
 *   npm run make-admin -- someone@example.com
 *
 * Exists because the alternative is a mongosh one-liner full of braces and
 * dollar signs, which PowerShell mangles.
 */
const { loadEnv } = require('../config/loadEnv.js');

const envFile = loadEnv();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db.js');
const { User } = require('../models/index.js');
const logger = require('../utils/logger.js');

async function run() {
  const email = (process.argv[2] || '').trim().toLowerCase();

  if (!email) {
    logger.error('Usage: npm run make-admin -- someone@example.com');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email });

  if (!user) {
    logger.error(`No account found for ${email}`);

    const others = await User.find().select('email role').sort({ createdAt: 1 }).limit(10).lean();
    if (others.length) {
      logger.info('Accounts that do exist:');
      others.forEach((u) => logger.info(`  ${u.email} (${u.role})`));
    } else {
      logger.info('There are no accounts yet — sign up first, then run this.');
    }

    await disconnectDB();
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }

  if (user.role === 'admin') {
    logger.info(`${email} is already an admin.`);
  } else {
    user.role = 'admin';
    await user.save();
    logger.info(`${email} is now an admin — the API Keys page is available on next sign-in.`);
  }

  await disconnectDB();
  await mongoose.disconnect().catch(() => {});
}

run().catch(async (err) => {
  logger.error('Could not promote the account', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
