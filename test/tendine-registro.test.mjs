// Il registro delle tendine sta nel gestionale (tools/tendine.cjs) e controlla anche
// quelle della segreteria: una tendina nuova o con voci cambiate qui va registrata là.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const strumento = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'gestionale-visite', 'tools', 'tendine.cjs');
test('tendine della segreteria registrate e allineate', { skip: !existsSync(strumento) && 'gestionale-visite non è accanto' }, () => {
  const { controlla } = createRequire(import.meta.url)(strumento);
  const errori = controlla();
  assert.deepEqual(errori, [], '\n' + errori.join('\n'));
});
