const cluster = require('node:cluster');
const os = require('node:os');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const numCPUs = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

if (cluster.isPrimary) {
  console.log(`[PRIMARY CLUSTER ${process.pid}] Master cluster process starting on ${numCPUs} CPU cores...`);

  // Fork worker processes
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[CLUSTER WARN] Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Forking replacement worker...`);
    cluster.fork();
  });
} else {
  const server = app.listen(PORT, () => {
    console.log(`[WORKER ${process.pid}] Listening on http://localhost:${server.address().port}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EPERM' || err.code === 'EADDRINUSE') {
      const fallbackServer = app.listen(0, () => {
        console.log(`[WORKER ${process.pid}] Listening on http://localhost:${fallbackServer.address().port}`);
      });
    } else {
      console.error('[WORKER ERROR]', err);
    }
  });
}
