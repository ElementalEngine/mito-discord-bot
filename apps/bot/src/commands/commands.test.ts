import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

type Option = { name: string; required?: boolean; options?: Option[] };

// Discord refuses a deploy whose required options follow an optional one.
function misplaced(options: readonly Option[] = [], path: string): string[] {
  const late = options.findIndex((o, i) => o.required && options.slice(0, i).some((p) => !p.required && !p.options));
  return [...(late >= 0 ? [`${path} ${options[late]!.name}`] : []), ...options.flatMap((o) => misplaced(o.options, `${path} ${o.name}`))];
}

test('every command lists its required options first', async () => {
  const root = new URL('./', import.meta.url);
  const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory());
  const found: string[] = [];
  for (const dir of dirs) {
    for (const file of (await readdir(new URL(`${dir.name}/`, root))).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const { data } = (await import(new URL(`${dir.name}/${file}`, root).href)) as { data: { toJSON(): Option & { options?: Option[] } } };
      const json = data.toJSON();
      found.push(...misplaced(json.options, `/${json.name}`));
    }
  }
  assert.deepEqual(found, []);
});
