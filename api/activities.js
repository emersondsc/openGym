// api/activities.js — limpeza de S.activities no PUT /api/data (docs/specs/spec_corrida.md §5).
//
// O servidor LIMPA, não recusa: uma corrida ruim nunca trava a gravação de treinos e rotinas.
// Confere só a FORMA, com os mesmos critérios de `readActivity` (frontend/src/lib/activities.js),
// mais o corte da nota. Os limites do produto (km ≤ 300, FC, elevação...) ficam só no app.
// O app guarda a mesma forma normalizada no merge, então o que sai daqui não volta no PUT seguinte.

export const ACT_MAX_ENTRIES = 5000;
export const ACT_NOTE_MAX = 1000;              // mesmo critério do noteBad (pontos de código)
const ID_RE = /^[a-z0-9]{1,40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLACES = ['outdoor', 'treadmill'];
const OPT_NUM = ['elev', 'hrAvg', 'hrMax', 'rpe'];
const ALLOWED = new Set(['d', 'sport', 'km', 'sec', 'min', 'place', 'elev', 'hrAvg', 'hrMax', 'rpe', 'note', 'src', '_ts']);

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round2 = v => Math.round(v * 100) / 100;

/**
 * @returns {{ map: object, dropped: number, fields: string[] }}
 *   `map` é o mapa a gravar; `dropped` conta entradas descartadas; `fields` são os nomes únicos
 *   (ordem alfabética) dos campos removidos ou corrigidos.
 */
export function sanitizeActivities(incoming, current, now = Date.now()) {
  const base = isObj(current) ? current : {};
  if (incoming === undefined) return { map: base, dropped: 0, fields: [] };
  if (!isObj(incoming)) return { map: base, dropped: 1, fields: [] };
  const keys = Object.keys(incoming);
  if (keys.length > ACT_MAX_ENTRIES) return { map: base, dropped: keys.length, fields: [] };

  const out = {};
  const fields = new Set();
  let dropped = 0;
  for (const id of keys) {
    const e = incoming[id];
    if (!ID_RE.test(id) || !isObj(e)) { dropped++; continue; }
    const ts = isNum(e._ts) && e._ts > 0 ? e._ts : null;
    if (e.deleted === true) {
      out[id] = { deleted: true, _ts: ts ?? now };
      continue;
    }
    const km = isNum(e.km) ? round2(e.km) : NaN;
    if (typeof e.d !== 'string' || !ISO_RE.test(e.d) || e.sport !== 'run' ||
        !(km > 0) || !Number.isInteger(e.sec) || e.sec <= 0) { dropped++; continue; }

    const min = Math.max(1, Math.round(e.sec / 60));
    const run = { d: e.d, sport: 'run', km, sec: e.sec, min };
    if (km !== e.km) fields.add('km');
    if (e.min !== min) fields.add('min');
    if (PLACES.includes(e.place)) run.place = e.place;
    else { run.place = 'outdoor'; fields.add('place'); }
    for (const k of OPT_NUM) {
      if (e[k] === undefined) continue;
      if (isNum(e[k])) run[k] = e[k];
      else fields.add(k);
    }
    if (e.note !== undefined) {
      if (typeof e.note !== 'string') fields.add('note');
      else {
        const cps = [...e.note];
        if (cps.length > ACT_NOTE_MAX) { run.note = cps.slice(0, ACT_NOTE_MAX).join(''); fields.add('note'); }
        else run.note = e.note;
      }
    }
    if (typeof e.src === 'string') run.src = e.src;
    else { run.src = 'manual'; fields.add('src'); }
    run._ts = ts ?? now;
    if (ts === null) fields.add('_ts');
    for (const k of Object.keys(e)) if (!ALLOWED.has(k) && k !== 'deleted') fields.add(k);
    out[id] = run;
  }
  return { map: out, dropped, fields: [...fields].sort() };
}
