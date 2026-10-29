const { getConfig, connectDatabase } = require('./config/env');
const app = require('./app');

async function start() {
  let config;
  try {
    config = getConfig();
  } catch (error) {
    console.error(`BugHunt configuration error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (config.timezoneInvalid) {
    console.warn('Invalid TZ setting; daily streak calculations are using Asia/Kolkata.');
  }

  try {
    await connectDatabase(config);
  } catch (error) {
    console.error(`BugHunt startup error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  app.listen(config.port, () => {
    console.log(`BugHunt is listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) start();

module.exports = { start };
