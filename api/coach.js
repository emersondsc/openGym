// api/coach.js — matemática portada de process_workout.py (200 linhas) + opengym_reader.py
// Sem fs de Hermes, sem csv-parse, sem compsio. Puro, recebe state já lido.
import { normUnit, kgFactor, unitOfSet } from './units.js';
import { loadCatalog, CATALOG_PATH } from './catalog.js';

// O catálogo é lido UMA vez por processo, do arquivo do app. Antes este arquivo fazia dois
// JSON.parse: um aqui no topo e outro dentro de rowsFromState() — ou seja, um por requisição de
// análise. Com o catálogo passando de 259 KB para 888 KB, manter aquilo seria pagar a leitura
// inteira a cada GET /api/coach/analysis.
// É daqui que sai a linha "catalogo carregado" no boot: este módulo é importado por server.js
// antes de routines.js.
const catalogEntries = loadCatalog(CATALOG_PATH) || new Map();

function isoWeekKeyUTC(dateStr){
  // dateStr YYYY-MM-DD UTC → YYYY-Sww ISO 8601 (segunda, semana 1 contém 4 jan, regra Thu)
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = Math.round((d - firstThu) / 604800000) + 1;
  return `${d.getUTCFullYear()}-S${String(week).padStart(2,'0')}`;
}

function e1rm(wKg, reps){
  if(!wKg || !reps || wKg <= 0 || reps <= 0 || reps > 30) return null;
  return wKg * (1 + reps / 30);
}

export function rowsFromState(state){
  const exmap = {};
  // catálogo base (1324 exercícios) — exId → nome e equipamento, já memoizado no topo do módulo
  for(const [id, e] of catalogEntries) exmap[id] = { n: e.n, eq: e.eq || '' };
  // customEx sobrescreve (nome original preservado)
  for(const c of (state.customEx || [])){
    if(c.id) exmap[c.id] = { n: c.n || c.id, eq: c.eq || 'custom' };
  }
  // A unidade é do exercício, não do perfil (BACKLOG-01): `0585`/`0599` são máquinas em
  // libras num perfil em kg. Cada série é convertida pela unidade dela — `wUnit` da série,
  // senão a prescrição que a sessão copiou (`entry.target.unit`), senão o perfil.
  const profileUnit = normUnit(state.unit);
  const rows = [];
  for(const w of (state.workouts || [])){
    const startMs = Number(w.start);
    const endMs = Number(w.end) || startMs;
    const fmt = (ms)=>{
      const d = new Date(Number(ms));
      const MESES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    };
    const start = fmt(startMs);
    const end = fmt(endMs) || start;
    const title = (w.name || 'Imported').trim();
    for(const e of (w.entries || [])){
      const exId = e.id || '';
      const meta = exmap[exId] || { n: exId, eq: '' };
      const baseName = meta.n || exId;
      const isBw = meta.eq === 'body weight';
      for(let i=0;i<((e.sets||[]).length);i++){
        const s = e.sets[i];
        const isWarm = String(s.phase || '').toLowerCase() === 'warmup' || s.warmup === true;
        const hasReps = s.r != null && String(s.r).trim() !== '';
        const isCardio = (s.min != null || s.speed != null) && !hasReps;
        const setType = isWarm ? 'warmup' : (isCardio ? 'cardio' : 'normal');
        let rpe = s.rpe;
        if(s.rir != null && Number.isFinite(Number(s.rir)) && Number(s.rir) >= 0 && Number(s.rir) <= 10){
          const v = 10 - Number(s.rir);
          if(Number.isFinite(v)) rpe = v;
        }
        if(rpe != null && !Number.isFinite(Number(rpe))) rpe = null;
        let wKg = 0;
        let setUnit = profileUnit;
        try{
          setUnit = unitOfSet(s, e, profileUnit);
          wKg = s.w == null || String(s.w).trim() === '' ? 0 : Number(s.w) * kgFactor(setUnit);
        }catch{ setUnit = profileUnit; wKg = 0; }
        const exName = (isBw && wKg > 0) ? `${baseName} (weighted)` : baseName;
        rows.push({
          title,
          start_time: start,
          end_time: end,
          _startMs: startMs,
          _endMs: endMs,
          _date: new Date(startMs).toLocaleDateString('en-CA', {timeZone: 'America/Sao_Paulo'}),
          exercise_title: exName,
          set_index: String(i),
          set_type: setType,
          weight_kg: s.w == null || String(s.w).trim() === '' ? '' : String(Math.round(wKg*100)/100),
          reps: hasReps ? String(s.r) : '',
          rpe: rpe == null || String(rpe).trim() === '' ? '' : String(rpe),
          _wKg: wKg,
          _unit: setUnit,
          _reps: hasReps ? Number(s.r) : null,
          _rpe: rpe == null || String(rpe).trim() === '' ? null : Number(rpe),
        });
      }
    }
  }
  return rows;
}

export function buildAnalysis(state){
  const rows = rowsFromState(state);

  // outlier por exercise_title (com weighted), só normal && wKg>0, n>=2 && w0 > 2.5*w1
  const byExW = new Map();
  for(const r of rows){
    if(r.set_type !== 'normal') continue;
    const w = Number(r._wKg)||0;
    if(w>0){
      if(!byExW.has(r.exercise_title)) byExW.set(r.exercise_title, []);
      byExW.get(r.exercise_title).push(w);
    }
  }
  const outlier = new Map();
  for(const [ex, ws] of byExW){
    ws.sort((a,b)=>b-a);
    if(ws.length>=2 && ws[0] > 2.5*ws[1]){
      outlier.set(ex, ws[0]); // valor cru max
    }
  }
  const isOutlier = (r)=>{
    if(r.set_type!=='normal') return false;
    if(!outlier.has(r.exercise_title)) return false;
    const w0 = outlier.get(r.exercise_title);
    return Math.abs(Number(r._wKg) - w0) < 0.001;
  };

  // sessões agrupadas por _startMs (epoch ms UTC), não por string
  const sessionsMap = new Map(); // _startMs -> {sets:[], startMs, endMs, title, date}
  for(const r of rows){
    const key = r._startMs;
    if(!sessionsMap.has(key)){
      sessionsMap.set(key, { sets:[], startMs:r._startMs, endMs:r._endMs, title:r.title, date:r._date });
    }
    sessionsMap.get(key).sets.push(r);
  }
  const sessList = [];
  const exProgress = new Map(); // ex -> Map(date -> {e1rmList, wmax, tonnage})
  for(const [startMs, s] of Array.from(sessionsMap.entries()).sort((a,b)=>a[0]-b[0])){
    const normal = s.sets.filter(x=>x.set_type==='normal' && !isOutlier(x));
    // tonnage e total_reps só de normal não-outlier, como no Python (s.sets normal filtrado de outlier)
    let ton = 0;
    let repsTot = 0;
    const rpes = [];
    const byEx = new Map();
    for(const x of s.sets){
      if(x.set_type==='normal' && !isOutlier(x)){
        const w = Number(x._wKg)||0;
        const reps = Number(x._reps)||0;
        if(w>0 && reps>0) ton += w*reps;
        if(reps>0) repsTot += reps;
        if(x._rpe!=null) rpes.push(Number(x._rpe));
        if(!byEx.has(x.exercise_title)) byEx.set(x.exercise_title, []);
        byEx.get(x.exercise_title).push(x);
      }
    }
    // exProgress por data
    for(const [ex, sets] of byEx){
      if(!exProgress.has(ex)) exProgress.set(ex, new Map());
      const m = exProgress.get(ex);
      const date = s.date;
      if(!m.has(date)) m.set(date, { e1rms:[], wmax:0, tonnage:0 });
      const cur = m.get(date);
      for(const x of sets){
        const e = e1rm(Number(x._wKg), Number(x._reps));
        if(e!=null) cur.e1rms.push(e);
        const w = Number(x._wKg)||0;
        if(w>cur.wmax) cur.wmax=w;
        if(w>0 && Number(x._reps)>0) cur.tonnage += w*Number(x._reps);
      }
    }
    const dur = s.endMs && s.startMs ? Math.round((s.endMs - s.startMs)/60000) : null;
    const n_ex = new Set(s.sets.filter(x=>x.set_type==='normal' && !isOutlier(x)).map(x=>x.exercise_title)).size;
    sessList.push({
      start: new Date(s.startMs).toISOString(),
      date: s.date,
      title: s.title || '',
      duration_min: dur,
      n_sets: s.sets.filter(x=>x.set_type==='normal' && !isOutlier(x)).length,
      n_exercises: n_ex,
      total_reps: Math.round(repsTot),
      tonnage: Math.round(ton),
      avg_rpe: rpes.length ? Math.round((rpes.reduce((a,b)=>a+b,0)/rpes.length)*10)/10 : null,
    });
  }

  // progress final: Map ex -> [{date,e1rm,wmax,tonnage}]
  const progress = {};
  for(const [ex, m] of exProgress){
    const arr = Array.from(m.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([date, v])=>{
      const e = v.e1rms.length ? Math.round(Math.max(...v.e1rms)) : null;
      return { date, e1rm:e, wmax: v.wmax? Math.round(v.wmax*100)/100 : null, tonnage: Math.round(v.tonnage) };
    });
    progress[ex]=arr;
  }

  // PRs: por ex, max e1rm
  const prs = [];
  for(const [ex, arr] of Object.entries(progress)){
    const valid = arr.filter(e=>e.e1rm!=null);
    if(valid.length){
      const best = valid.reduce((a,b)=> a.e1rm > b.e1rm ? a : b);
      const wmax = Math.max(...arr.map(e=>e.wmax||0));
      prs.push({ ex, e1rm: best.e1rm, date: best.date, wmax: wmax||null, reps:null, sets: arr.length, last_date: arr[arr.length-1].date });
    }
  }
  prs.sort((a,b)=>b.e1rm - a.e1rm);

  // weeks ISO UTC
  const weekly = new Map();
  for(const s of sessList){
    const wk = isoWeekKeyUTC(s.date);
    if(!weekly.has(wk)) weekly.set(wk, { sessions:0, tonnage:0, sets:0 });
    const cur = weekly.get(wk);
    cur.sessions+=1; cur.tonnage+=s.tonnage; cur.sets+=s.n_sets;
  }
  const weeks = Array.from(weekly.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([week, v])=>({ week, sessions:v.sessions, tonnage:v.tonnage, sets:v.sets }));

  // months YYYY-MM
  const monthly = new Map();
  for(const s of sessList){
    const m = s.date.slice(0,7);
    if(!monthly.has(m)) monthly.set(m, { sessions:0, tonnage:0, sets:0 });
    const cur=monthly.get(m); cur.sessions+=1; cur.tonnage+=s.tonnage; cur.sets+=s.n_sets;
  }
  const months = Array.from(monthly.entries()).sort((a,b)=>a[0].localeCompare(b[0])).map(([month,v])=>({ month, sessions:v.sessions, tonnage:v.tonnage, sets:v.sets }));

  // top_ex e titles
  const exCounts = new Map();
  const titleCounts = new Map();
  for(const r of rows){
    if(r.set_type!=='normal' || isOutlier(r)) continue;
    exCounts.set(r.exercise_title, (exCounts.get(r.exercise_title)||0)+1);
  }
  for(const s of sessList){
    titleCounts.set(s.title, (titleCounts.get(s.title)||0)+1);
  }
  const top_ex = Array.from(exCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,15);
  const titles = Array.from(titleCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0,15);

  const n_exercises = exProgress.size;
  const period = sessList.length ? { first:sessList[0].date, last:sessList[sessList.length-1].date } : { first:null, last:null };

  const analysis = {
    n_sets: rows.length,
    n_sessions: sessList.length,
    n_exercises,
    period,
    sessions: sessList,
    prs,
    weeks,
    months,
    top_ex,
    titles,
  };

  return { analysis, progress };
}
