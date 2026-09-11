import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientApiUrl } from '../src/services/apiUrlPolicy.ts';

test('production client API URL is explicit, HTTPS and points to /api', () => {
  assert.equal(
    resolveClientApiUrl('https://api.agenda.example/api/', true),
    'https://api.agenda.example/api'
  );
});

test('production client API URL rejects local, HTTP and incoherent paths', () => {
  assert.throws(() => resolveClientApiUrl(undefined, true), /PUBLIC_API_URL no está definida/);
  assert.throws(() => resolveClientApiUrl('http://api.agenda.example/api', true), /HTTPS/);
  assert.throws(() => resolveClientApiUrl('https://localhost/api', true), /host local/);
  assert.throws(() => resolveClientApiUrl('https://api.agenda.example/v1', true), /prefijo \/api/);
  assert.throws(() => resolveClientApiUrl('https://api.agenda.example/api?token=x', true), /query/);
});

test('development may use local HTTP but still requires the canonical /api prefix', () => {
  assert.equal(resolveClientApiUrl('http://localhost:3000/api', false), 'http://localhost:3000/api');
  assert.throws(() => resolveClientApiUrl('ftp://localhost/api', false), /HTTP\(S\)/);
});
