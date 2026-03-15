const name = 'stats-server';

async function init(framework, options = {}) {
    const http = require('http');
    const port = options.port ?? 3001;
    const path = options.path ?? '/stats';
    const token = options.token ?? null;

    const server = http.createServer(async (req, res) => {
        if (req.url !== path) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        if (token) {
            const auth = req.headers['authorization'];
            if (auth !== `Bearer ${token}`) {
                res.writeHead(401);
                res.end('Unauthorized');
                return;
            }
        }

        try {
            const payload = await framework.stats.getPayload();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
        } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: 'Internal error' }));
        }
    });

    server.listen(port, () => {
        console.log(`[stats-server] Listening on port ${port} at ${path}`);
    });

    framework.onShutdown(() => new Promise(r => server.close(r)));
    framework.statsServer = server;
}

module.exports = { name, init };
