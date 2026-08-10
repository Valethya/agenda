import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(currentDir, "../../src");

const walkJsFiles = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkJsFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
};

const runtimeFiles = await walkJsFiles(srcRoot);
const runtimeSources = await Promise.all(runtimeFiles.map(async (file) => ({
  file: path.relative(srcRoot, file),
  content: await fs.readFile(file, "utf8"),
})));

const findMatches = (pattern) => runtimeSources
  .filter(({ content }) => pattern.test(content))
  .map(({ file }) => file);

test("6.2.3 runtime no conserva APIs globales de disponibilidad por worker", () => {
  const forbidden = [
    /shiftRepository\.findByWorker\s*\(/u,
    /shiftRepository\.findByWorkerAndDay\s*\(/u,
    /shiftRepository\.upsert\s*\(/u,
    /shiftRepository\.deleteByWorker\s*\(/u,
    /blockRepository\.findByWorkerAndDateRange\s*\(/u,
    /blockRepository\.deleteById\s*\(/u,
    /blockRepository\.create\s*\(/u,
    /appointmentRepository\.findByWorkerAndDate\s*\(/u,
  ];

  for (const pattern of forbidden) {
    assert.deepEqual(findMatches(pattern), [], `API global encontrada para ${pattern}`);
  }
});

test("6.2.3 acceso directo Shift/Block permanece encapsulado en repositories", () => {
  const shiftDirect = findMatches(/\bShift\.(?:find|findOne|findOneAndUpdate|deleteMany)\s*\(/u);
  const blockDirect = findMatches(/\bBlock\.(?:find|findOne|findOneAndDelete|create)\s*\(/u);

  assert.deepEqual(shiftDirect, ["repositories/shift.repository.js"]);
  assert.deepEqual(blockDirect, ["repositories/block.repository.js"]);
});

test("6.2.3 runtime no declara índices globales obsoletos de disponibilidad", () => {
  assert.deepEqual(findMatches(/\{\s*worker:\s*1,\s*dayOfWeek:\s*1\s*\}/u), []);
  assert.deepEqual(findMatches(/\{\s*worker:\s*1,\s*date:\s*1,\s*startTime:\s*1\s*\}/u), []);
});
