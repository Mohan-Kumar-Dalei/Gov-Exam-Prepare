const mongoose = require('mongoose');

const logger = require('../utils/logger.js');

mongoose.set('strictQuery', true);

async function connectDB() {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error('MongoDB error', err.message));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  const uri = process.env.MONGO_URI;
  if (!uri) {
    logger.warn(
      'MONGO_URI is not set — falling back to mongodb://127.0.0.1:27017/ai-exam-coach. ' +
        'Check that .env was found.',
    );
  }

  await mongoose.connect(uri || 'mongodb://127.0.0.1:27017/ai-exam-coach', {
    autoIndex: process.env.NODE_ENV !== 'production',
    serverSelectionTimeoutMS: 15000,
  });
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.connection.close();
}

module.exports = connectDB;
Object.assign(module.exports, { connectDB, disconnectDB });
