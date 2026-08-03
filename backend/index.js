const app = require('./app');
const { initDB, closeDB } = require('./database');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    const server = app.listen(PORT, () => {
      logger.info(`KejaHub running on http://localhost:${PORT}`);
    });

    // better-sqlite3 writes through to disk on every statement, so shutdown
    // just needs to close the handle cleanly, not flush anything.
    const shutdown = (signal) => {
      logger.info(`${signal} received. Closing database and shutting down.`);
      server.close(() => {
        closeDB();
        process.exit(0);
      });
      setTimeout(() => {
        closeDB();
        process.exit(1);
      }, 8000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => logger.error('Startup failed', { err }));
