import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolvePublicBookingSlugFromSearch } from '../src/features/public-booking/runtimeSlug.ts';

const flowPath = fileURLToPath(new URL('../src/features/public-booking/PublicBookingFlow.tsx', import.meta.url));
const pagePath = fileURLToPath(new URL('../src/pages/reservar.astro', import.meta.url));
const configPath = fileURLToPath(new URL('../astro.config.mjs', import.meta.url));

test('bootstrap runtime usa el slug normalizado de la URL real del navegador', () => {
  const runtimeUrl = new URL('https://agenda.example/reservar?slug=%20atmosfera%20');
  assert.equal(resolvePublicBookingSlugFromSearch(runtimeUrl.search), 'atmosfera');
});

test('slug ausente, vacío o whitespace queda inválido antes de discovery', async () => {
  assert.equal(resolvePublicBookingSlugFromSearch(''), null);
  assert.equal(resolvePublicBookingSlugFromSearch('?slug='), null);
  assert.equal(resolvePublicBookingSlugFromSearch('?slug=%20%20'), null);

  const flow = await readFile(flowPath, 'utf8');
  assert.match(flow, /resolvePublicBookingSlugFromSearch\(window\.location\.search\)/u);
  assert.match(flow, /if \(!slug\) return;/u);
  assert.doesNotMatch(flow, /createPublicBookingApi\(\{ slug: rawSlug/u);
});

test('/reservar permanece estática y no depende del query durante prerender', async () => {
  const [page, config] = await Promise.all([
    readFile(pagePath, 'utf8'),
    readFile(configPath, 'utf8'),
  ]);

  assert.match(page, /<PublicBookingFlow client:load \/>/u);
  assert.doesNotMatch(page, /Astro\.url\.searchParams/u);
  assert.doesNotMatch(page, /prerender\s*=\s*false/u);
  assert.doesNotMatch(config, /output\s*:\s*['"](?:server|hybrid)['"]/u);
  assert.doesNotMatch(config, /adapter/u);
});
