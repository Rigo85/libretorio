import {afterAll, beforeAll, expect, test} from '@jest/globals';
import {createServer, IncomingHttpHeaders, Server} from 'http';
import {AddressInfo} from 'net';

const redirects = require('follow-redirects').http;
let source: Server, destination: Server, sourcePort: number;
let receivedAtSource: IncomingHttpHeaders;
const listen = (server: Server) => new Promise<number>(resolve => {
  server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
});

beforeAll(async () => {
  destination = createServer((req, res) => res.end(JSON.stringify(req.headers)));
  const destinationPort = await listen(destination);
  source = createServer((req, res) => {
    receivedAtSource = req.headers;
    res.writeHead(302, {Location: `http://127.0.0.1:${destinationPort}/target`});
    res.end();
  });
  sourcePort = await listen(source);
});

afterAll(async () => {
  for (const server of [source, destination]) {
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

function redirectedHeaders(headers: string[] | Record<string, string>, sensitiveHeaders: string[] = []): Promise<IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    const request = redirects.get(`http://127.0.0.1:${sourcePort}/`, {headers, sensitiveHeaders}, (response: any) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => body += chunk);
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
    request.setTimeout(2000, () => request.destroy(new Error('Local redirect test timed out')));
  });
}

test('strips sensitive array-form headers across origins without dropping ordinary headers', async () => {
  const received = await redirectedHeaders(['Host', `127.0.0.1:${sourcePort}`, 'Authorization', 'Bearer fixture', 'Cookie', 'session=fixture', 'X-Public', 'kept']);
  expect(receivedAtSource.authorization).toBe('Bearer fixture');
  expect(receivedAtSource.cookie).toBe('session=fixture');
  expect(received.authorization).toBeUndefined();
  expect(received.cookie).toBeUndefined();
  expect(received['x-public']).toBe('kept');
});

test('treats custom sensitive header names as literals rather than regex patterns', async () => {
  const received = await redirectedHeaders({'X-Secret^': 'fixture', 'X-Public': 'kept'}, ['X-Secret^']);
  expect(receivedAtSource['x-secret^']).toBe('fixture');
  expect(received['x-secret^']).toBeUndefined();
  expect(received['x-public']).toBe('kept');
});
