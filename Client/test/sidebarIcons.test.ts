import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sidebarSource = readFileSync(
  new URL('../src/components/Sidebar.tsx', import.meta.url),
  'utf8'
);
const iconsSource = readFileSync(
  new URL('../src/components/icons/SidebarIcons.tsx', import.meta.url),
  'utf8'
);

test('keeps SVG markup outside the Sidebar component', () => {
  assert.equal(sidebarSource.includes('<svg'), false);
  assert.equal(sidebarSource.includes('@ts-ignore'), false);
});

test('exposes the complete sidebar icon set through one accessible wrapper', () => {
  const exportedIcons = iconsSource.match(/export const \w+Icon/g) || [];

  assert.equal(exportedIcons.length, 10);
  assert.match(iconsSource, /aria-hidden="true"/);
  assert.match(iconsSource, /focusable="false"/);
});
