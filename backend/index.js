const app = require('./app');
const { initDB, saveDB } = require('./database');

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    const server = app.listen(PORT, () => {
      console.log(`KejaHub running on http://localhost:${PORT}`);
    });

    // Flush the in-memory database before exiting, so a deploy or restart doesn't
    // discard writes made since the last periodic save.
    const shutdown = (signal) => {
      console.log(`\n${signal} received. Saving database and shutting down.`);
      server.close(() => {
        saveDB();
        process.exit(0);
      });
      setTimeout(() => {
        saveDB();
        process.exit(1);
      }, 8000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch(console.error);
