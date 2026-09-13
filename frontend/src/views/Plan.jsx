import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, uid, exCount, fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { weekAt, mesoState, todayInMeso, activateMesoState } from '../lib/meso.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet, mesoListSheet, mesoFormSheet, importMesoFile } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  // ---- mesociclo ativo (painel enxuto: nome, semana N de M e fase) ----
  const today = todayInMeso()                       // fuso do mesociclo, não do aparelho
  const active = (S.mesos || []).find(m => m.id === S.activeMeso) || null
  const state = mesoState(active, today)
  const candidate = active ? null : (S.mesos || []).find(m => mesoState(m, today) === 'current') || null
  const wk = active ? weekAt(active, today) : null
  // Fora do período, a linha mostra a primeira semana (futuro) ou a última (terminado), para
  // nunca ficar vazia.
  const shown = wk || (active ? (state === 'future' ? active.weeks[0] : active.weeks[active.weeks.length - 1]) : null)
  const summaryOf = m => shown
    ? t('week {0} of {1}', shown.n, m.weeks.length) + ' · ' + shown.phase
    : t('{0} weeks', m.weeks.length)

  const activate = id => update(s => {
    if (!activateMesoState(s, id, 'user')) return
    useUI.getState().toast(t('{0} is now your mesocycle', (s.mesos.find(m => m.id === id) || {}).name))
    useUI.getState().toast(t('Your published week stays as it is until the next publication.'))
  })
  // O "Importar" do mesociclo vencido usa o mesmo input escondido da folha, criado na hora.
  const pickMesoFile = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'application/json,.json,text/csv,.csv'
    inp.onchange = () => { const f = inp.files[0]; if (f) importMesoFile(f) }
    inp.click()
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>

    <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
      <h4 className="sec" style={{ margin: 0 }}>{t('Mesocycle')}</h4>
      <div className="row" style={{ gap: 8 }}>
        {/* A biblioteca precisava de uma porta: com um mesociclo ativo, a linha do painel abre a
            tela dele, e não havia como ver os outros (foi assim que um mesociclo recém-criado
            ficou invisível). `New` continua sendo a ação forte; `All` é a secundária. */}
        <Button size="sm" variant="ghost" icon="list" onClick={mesoListSheet}>{t('All')}</Button>
        <Button size="sm" variant="tinted" icon="plus" onClick={() => mesoFormSheet({})}>{t('New')}</Button>
      </div>
    </div>
    <div className="list" style={{ marginBottom: 4 }}>
      {active ? <div className="item" onClick={() => nav('/plan/meso/' + active.id)}>
        <div className="grow">
          <div className="tt">{active.name}</div>
          <div className="ss">{summaryOf(active)}</div>
        </div>
        {state === 'ended' && <span className="tag">{t('ended')}</span>}
        <Icon name="chevronRight" className="chev" /></div>
      : candidate ? <div className="item" onClick={() => activate(candidate.id)}>
        <div className="grow">
          <div className="tt">{candidate.name}</div>
          <div className="ss">{t('covers today')} · {t('tap to activate')}</div>
        </div>
        <Icon name="chevronRight" className="chev" /></div>
      : <div className="item" onClick={mesoListSheet}>
        <div className="grow">
          <div className="tt">{t('No mesocycle yet')}</div>
          <div className="ss">{t('Create one, or import a file')}</div>
        </div>
        <Icon name="chevronRight" className="chev" /></div>}
    </div>
    {active && state === 'ended' && <div className="sect-f">
      {t('{0} ended on {1}.', active.name, fmtDate(active.end))}{' '}
      <a onClick={() => mesoFormSheet({})}>{t('Start the next one')}</a>{' · '}
      <a onClick={pickMesoFile}>{t('Import')}</a>
    </div>}
    {active && active.activatedBy === 'assistant' && S.mesoPrev && <div className="sect-f">
      <span className="tag acc">{t('Activated by the assistant')}</span>{' '}
      <a onClick={() => activate(S.mesoPrev)}>{t('Back to the previous one')}</a>
    </div>}
    {/* O botão "Gerar micro S(n)" entra aqui na spec do BACKLOG-02. O lugar é este. */}

    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}
