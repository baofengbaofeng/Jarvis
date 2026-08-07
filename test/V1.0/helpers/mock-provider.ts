import { createServer, get as httpsGet, type IncomingMessage, type ServerResponse } from 'node:https';

export interface MockProviderHandle {
  /** Provider base URL without trailing /v1 (adapter appends /v1/chat/completions). */
  baseUrl: string;
  port: number;
  replyText: string;
  close(): Promise<void>;
}

// Self-signed cert for 127.0.0.1 — Electron test env sets NODE_TLS_REJECT_UNAUTHORIZED=0.
const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDXvsnLAY0IIKzq
amMlhbcIZQFrliBYtFxbzEdcjIF1af8gGVAmpT1pBOuMYS99+roKILZGACJZebfF
qG1WQISaCEuJD8PEqEYxbgeF/6L+3KTT7DqPY/IBrxyY2vAIqQMoiLafCicSZ88z
qmKZyj3iYoVRX93a2IDD9lub/vQ9ad5QEi7kngA9JTR1FDO3/ZSkgpBbtvdDdQrN
9wjthM7PSRpobT4IBRAbOjLgvuUqjUzV7h1tcd4Qocm6k/6qOqU2c2d6t0b+WVgD
d09GHsHdywgFTLvXIyuQxLiB/HSnA7LpCvmZB/b6capsTfPf6MDnPq8ksvovh5rn
hGjLjZx9AgMBAAECggEAHrlP2XYmFHM6zMNLzUsmjq57rkuZ3agJwxTrULW9te/b
YkHYlThQ74TA2qP4dHNhTRHtgzh/q8hWsHJU58SWXa0yvJkfIwFnxaBKt/14w9y+
KGPqzwLHsw+x/d6n8kPHbF1TzIBQoiFgc5YfJpGTkIrBO55wZLsSU1XhI+0B8UDA
dVf1gyot5UJPhrZO57dapaeMZAiErSjrJ5r4MdrYWyDZ7I1Q7LDWOxWPi5R67TjM
W9bBMUv1lE5H3Ub/QVATAvFDH0N8WMxEL5qJLPiv8Jc7lNY6CSY+ZAai1Jnus1fL
x4MjUTKa0JMFOqHgGL3c7G9QS79x8ANTEFWpkyprbQKBgQDrqjC8Wkdl8nozPUSW
gv5SP8V53Sk8oRFX7h3k49097l/eQgNjD5fpjSU2WCVyzl3r1YJ2pKvcOGU5rCqz
3bi3MJz+gOwrIMOxm7Zlz54rKW2Z/3TrTmQixz4ItQnWwiZZinLVZKVxtC9v7egG
0OYK+VDNx9Fdii7UXu6bE0kY0wKBgQDqXJPTZAcVMQQFAK6geHBzff7x6jCPDr9O
B2z2z6raCK2hDWQjDhotqVNC/wodCPGlgNCsdfWg2LTrPobKscEza0q8rSN4Wai2
yMeOU/jlqqZxSPfpIM7YqxsjrxVcmqdyWXCXuouAAMi/l2k5mPt6ez1g6JZMif4J
VXbIg00jbwKBgBkI4ViA9qi704Nx9MFQdRfjsmS5u9G3ApKmtwJDupMDqaeAt79k
Pq0O028sef3yMkQFUHCuGZuxWf+AbKDi4uaDAYp/w5bpSiCp+/xgy9ql8gC0BIWi
tDyFke922+62fUBx1rUYlgK4M3neehGPS4DK72yM147qSQNCenJ63/8FAoGBAIUz
GNGMiHoC4cX2HUoXKdJ6Sew0rmSgfRpcHhIo9XH2fLiMY92IplhNZIUvbxARhUYL
cI6UfIZupGUPpIyPer8+u7uArCg6zSkV9FVwZIYj93Vrg3t8qhN7LHGbkQiQ3Zqg
Ot4BqEeYKoC6DZQu3r8+TCRIDSRzSW8Eo/5SogUBAoGARaWZD2U2jqJZrwOkefTC
t+3IPR6YI+EqY5VuZ4XFoUx7VIPz1m6C4WJg2RoUNUUlQOTWA73yfB3vAQqjPsBB
ep/vbikiT9mERe+k4S/ZaOqPX/htJnjRBfCSsEyRMA2rth8wGM8M25HmDpZfyv4w
0RtImggdknf+y8Qxu5zLPpw=
-----END PRIVATE KEY-----`;

const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIICyTCCAbGgAwIBAgIJALPz3oxPNa9HMA0GCSqGSIb3DQEBCwUAMBQxEjAQBgNV
BAMMCTEyNy4wLjAuMTAeFw0yNjA4MDYwOTE5MjFaFw0yNzA4MDYwOTE5MjFaMBQx
EjAQBgNVBAMMCTEyNy4wLjAuMTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoC
ggEBANe+ycsBjQggrOpqYyWFtwhlAWuWIFi0XFvMR1yMgXVp/yAZUCalPWkE64xh
L336ugogtkYAIll5t8WobVZAhJoIS4kPw8SoRjFuB4X/ov7cpNPsOo9j8gGvHJja
8AipAyiItp8KJxJnzzOqYpnKPeJihVFf3drYgMP2W5v+9D1p3lASLuSeAD0lNHUU
M7f9lKSCkFu290N1Cs33CO2Ezs9JGmhtPggFEBs6MuC+5SqNTNXuHW1x3hChybqT
/qo6pTZzZ3q3Rv5ZWAN3T0Yewd3LCAVMu9cjK5DEuIH8dKcDsukK+ZkH9vpxqmxN
89/owOc+rySy+i+HmueEaMuNnH0CAwEAAaMeMBwwGgYDVR0RBBMwEYIJbG9jYWxo
b3N0hwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQCe80ohrKY9dR33Ms7TjiKW8+2G
1h+CQadnK5l79BXtK6sCeLh3mdPYbCT+gV6oYX/XQOFYWqu2RFeXm7WRJs5Lp1/J
hRa/AZQHgzgsSwyTyJrXmCr9E67jhF8Pd9Ozmse/mGVLGGIaJCIXjjcNXVh+i1Vt
71S1E9dXStGsefchLJG+p+llK6ahurEDbsO0TKO8R7BeFPK1FcVuLK10y+eGGZSi
wpUXp9OpEGlkgU2oEJxDxiApoz5CPcfX7YB2mfDj6ll05xB4IDW6vqczFLiRsG+e
zI+dqpWvo3QYd4Mf6xCsZTrBT2iBZfsFPwLbvldlIjdXN2iug+Cmj2Sg2Xgz
-----END CERTIFICATE-----`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isChatCompletions(pathname: string): boolean {
  return pathname === '/v1/chat/completions' || pathname === '/chat/completions';
}

/** Node-side GET /health (self-signed TLS; Playwright test runner does not inherit Electron TLS env). */
export function fetchMockHealth(handle: Pick<MockProviderHandle, 'baseUrl'>): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(`${handle.baseUrl}/health`, { rejectUnauthorized: false }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', reject);
  });
}

export async function startMockOpenAIProvider(opts?: {
  replyText?: string;
}): Promise<MockProviderHandle> {
  const replyText = opts?.replyText ?? 'mock reply';

  const server = createServer({ key: TLS_KEY, cert: TLS_CERT }, async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'https://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }

    if (req.method !== 'POST' || !isChatCompletions(url.pathname)) {
      res.writeHead(404).end();
      return;
    }

    const raw = await readBody(req);
    let stream = false;
    try {
      const body = JSON.parse(raw) as { stream?: boolean };
      stream = body.stream === true;
    } catch {
      /* non-JSON body — treat as non-streaming */
    }

    if (stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const delta = JSON.stringify({ choices: [{ delta: { content: replyText } }] });
      res.write(`data: ${delta}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock-chatcmpl',
      choices: [{ message: { role: 'assistant', content: replyText } }],
    }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('mock provider did not bind a TCP port');
  }

  const port = address.port;
  return {
    baseUrl: `https://127.0.0.1:${port}`,
    port,
    replyText,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
