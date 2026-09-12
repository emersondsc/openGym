// api/catalog.js — leitor único do catálogo de exercícios.
//
// FONTE ÚNICA: `frontend/src/lib/exercises-data.json`, o mesmo arquivo que o app carrega.
// Ninguém escreve nele em produção — a API e o agente Hermes só leem. O caminho é relativo
// a este arquivo (`../frontend/src/lib/...`) e a árvore dentro da imagem Docker espelha a do
// repositório de propósito (api/Dockerfile), então o mesmo caminho relativo vale no Pi e no
// container: não existe um segundo caminho para ninguém decorar.
//
// `OG_CATALOG` aponta para outro arquivo sem rebuild — é o que os testes usam.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Quantos exercícios a base tem hoje. Divergir não é erro — é aviso no boot. */
export const CATALOG_EXPECTED = 1324;

/** Caminho canônico do catálogo. */
export const CATALOG_PATH = process.env.OG_CATALOG
  || path.join(API_DIR, '..', 'frontend', 'src', 'lib', 'exercises-data.json');

let _map = null;          // Map id → entrada, ou null quando indisponível
let _loadedPath = null;   // caminho a que `_map` corresponde

/**
 * Mapa id → entrada do catálogo. Memoizado POR CAMINHO: repetir o mesmo caminho devolve o
 * cache; passar outro caminho carrega aquele (é o que permite o fixture dos testes conviver
 * com o catálogo real no mesmo processo). `null` = indisponível.
 *
 * Aceita lista (formato canônico) ou objeto id → entrada, para não quebrar um `OG_CATALOG`
 * antigo apontando para um arquivo no formato do catálogo espelhado.
 */
export function loadCatalog(catalogPath = CATALOG_PATH) {
  if (_loadedPath === catalogPath) return _map;
  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const map = new Map();
    if (Array.isArray(raw)) for (const c of raw) { if (c && c.id) map.set(c.id, c); }
    else for (const [id, v] of Object.entries(raw)) map.set(id, typeof v === 'object' ? v : {});
    _map = map;
    _loadedPath = catalogPath;
    console.log(`[og-routine] catalogo carregado: ${map.size} exercicios de ${catalogPath}`);
  } catch (e) {
    console.error('[og-routine] catalogo indisponivel:', catalogPath, e.message);
    _map = null;
    _loadedPath = catalogPath;
  }
  return _map;
}

/** Só para o teste: esquece o que estava memoizado. */
export function __resetCatalogCache() { _map = null; _loadedPath = null; }

/**
 * Equipamento declarado do exercício — usado na validação de rotina.
 * É um *peek*, não dispara carga, e só enxerga o mapa se ele for do caminho pedido: antes lia
 * o mapa global, que é o do ÚLTIMO caminho carregado, e devolveria o equipamento de outro
 * catálogo sem avisar.
 */
export function catalogEq(id, catalogPath = CATALOG_PATH) {
  return (_loadedPath === catalogPath ? _map : null)?.get(id)?.eq || null;
}
