// api/catalog.test.js — o arquivo canônico existe e tem a forma que a API espera.
//
//   node --test api/catalog.test.js
//
// Este teste lê o arquivo DIRETO, sem passar por loadCatalog(): o cache daquele módulo é
// compartilhado por todos os arquivos de teste do mesmo processo, e routines.test.js o aponta
// para um fixture de 4 entradas. A ordem entre arquivos não é garantida, então a única forma de
// ser correto sob qualquer ordem é não tocar no cache.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CATALOG_PATH, CATALOG_EXPECTED } from './catalog.js';

// O mesmo esquema da lista canônica (docs/specs/spec_catalogo_unico.md).
const FIELDS = ['id', 'n', 'bp', 'eq', 'tg', 'mg', 'sm', 'st', 'img', 'gif'];

describe('catálogo canônico', () => {
  test('o arquivo do app existe, é lista, e tem os campos que a API usa', () => {
    assert.ok(CATALOG_PATH.endsWith('frontend/src/lib/exercises-data.json'),
      `caminho inesperado: ${CATALOG_PATH}`);
    const data = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    assert.ok(Array.isArray(data), 'o catálogo precisa ser uma lista');
    assert.equal(data.length, CATALOG_EXPECTED);

    for (const e of data) {
      for (const f of FIELDS) assert.ok(f in e, `${e.id}: campo ausente ${f}`);
    }
    const ids = new Set(data.map(e => e.id));
    assert.equal(ids.size, data.length, 'há id repetido');
    for (const id of ids) assert.match(id, /^\d{4}$/);

    const le = data.find(e => e.id === '0001');
    assert.equal(typeof le.n, 'string');
    assert.ok(le.n.length > 0);
    assert.equal(typeof le.eq, 'string');
    assert.ok(le.img && le.gif);
  });
});
