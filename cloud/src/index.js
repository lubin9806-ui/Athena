'use strict';

const { loadConfig } = require('./config');
const { createCloudApp } = require('./server');

async function main() {
  const config = loadConfig();
  const app = createCloudApp(config);
  const address = await app.listen();
  process.stdout.write(`ATHENA_CLOUD_READY env=${config.environment} address=${address.address}:${address.port} region=${config.region} provider=${config.cloudProvider}\n`);
  const shutdown = async (signal) => {
    process.stdout.write(`ATHENA_CLOUD_SHUTDOWN signal=${signal}\n`);
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`ATHENA_CLOUD_FATAL ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
