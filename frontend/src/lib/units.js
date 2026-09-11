// frontend/src/lib/units.js — quem decide em que unidade um peso está (BACKLOG-01).
//
// Uma unidade é uma propriedade do exercício, não do perfil: `0585` e `0599` são máquinas
// em libras num perfil em kg. A regra é a mesma de `mode`/`bodyweight`/`side` — campo
// ausente herda o perfil, e nenhum dado antigo precisa ser migrado para continuar lendo
// exatamente o que lia antes.
//
// Espelhado em `api/units.js` de propósito: `api/` é um pacote separado e não enxerga
// `frontend/src/` (mesmo precedente de `api/coach.js`, matemática portada). Ao mudar uma
// das duas cópias, mude a outra.
export const LB_TO_KG = 0.45359237

// Normaliza o que vier do estado, do import ou de um agente. Qualquer coisa que comece
// com "lb" é libra ("lb", "lbs", "LB") — o coach escreve "200 lbs" em texto livre — e
// todo o resto é kg, que é o padrão do app.
export const normUnit = v => (String(v ?? '').trim().toLowerCase().startsWith('lb') ? 'lb' : 'kg')

export const isLb = v => normUnit(v) === 'lb'
export const kgFactor = v => (isLb(v) ? LB_TO_KG : 1)

// Valor cru de uma série → kg (o que a análise soma).
export const toKg = (w, unit) => (Number(w) || 0) * kgFactor(unit)
// kg → a unidade pedida, com a mesma precisão de 1 casa que o resto do app usa.
export const fromKg = (kg, unit) => Math.round(((Number(kg) || 0) / kgFactor(unit)) * 10) / 10

// A unidade de um exercício na rotina (ou no sheet de configuração).
export const unitOfCfg = (cfg, S) => normUnit(cfg && cfg.unit != null ? cfg.unit : S && S.unit)
// A unidade de uma entrada de treino — a prescrição que a sessão copiou ao começar.
export const unitOfEntry = (entry, S) =>
  normUnit(entry && entry.target && entry.target.unit != null ? entry.target.unit : S && S.unit)
// A unidade de UMA série, na ordem canônica (RF-1): override da série → prescrição da
// sessão → perfil.
export const unitOfSet = (s, entry, S) => normUnit(
  s && s.wUnit != null ? s.wUnit
    : entry && entry.target && entry.target.unit != null ? entry.target.unit
      : S && S.unit)
