// frontend/src/views/MesoEdit.jsx — a tela de um mesociclo.
//
// Mostra o mesmo esqueleto para o mesociclo do assistente (rico: 9 regras, evidência, histórico)
// e para o do usuário (magro: objetivo e uma regra): seção sem dado NÃO renderiza, então nenhum
// dos dois parece inacabado. O que é longo abre sob demanda.
//
// Datas do mesociclo vêm em ISO; o carimbo de ativação vem com hora, então é cortado antes do
// `fmtDate` (que monta `new Date(iso + 'T12:00:00')` e devolveria "Invalid Date" com a hora junto).
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { weekAt, mesoState, todayInMeso, extrasOf, activateMesoState } from '../lib/meso.js'
import { mesoActionsSheet, mesoFormSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Segmented, Button } from '../components/ui.jsx'

// Título curto da prioridade longa do coach: a primeira cláusula vira título e o resto continua
// ali do lado, sem cortar nada.
function headAndRest(text) {
  const s = String(text || '')
  const cut = s.search(/ \(| — | · /)
  return cut > 0 ? [s.slice(0, cut), s.slice(cut)] : [s, '']
}

export default function MesoEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [sel, setSel] = useState(null)
  const [open, setOpen] = useState({ rules: false, evidence: false, log: false, extras: false })

  const meso = (S.mesos || []).find(m => m.id === id)
  if (!meso) return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}><h1 style={{ fontSize: 24 }}>{t('Mesocycle')}</h1></div>
    </div>
    <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('That mesocycle is not in this profile.')}</div>
  </>

  const today = todayInMeso()
  const state = mesoState(meso, today)
  const weeks = meso.weeks
  const current = weekAt(meso, today)
  const w = weeks.find(x => x.n === (sel ?? current?.n ?? (state === 'ended' ? weeks[weeks.length - 1].n : 1))) || weeks[0]
  const active = S.activeMeso === meso.id
  const extras = extrasOf(meso)
  const rules = Object.entries(meso.rules || {})
  const shownRules = open.rules ? rules : rules.slice(0, 3)
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }))

  const activate = () => update(s => {
    if (!activateMesoState(s, id, 'user')) return
    useUI.getState().toast(t('{0} is now your mesocycle', meso.name))
    useUI.getState().toast(t('Your published week stays as it is until the next publication.'))
  })

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={meso.name}
          style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          aria-label={t('Name')}
          onChange={e => update(s => {
            const m = s.mesos.find(x => x.id === id)
            if (m) { m.name = e.target.value.trim() || t('Mesocycle'); m.updatedAt = new Date().toISOString() }
          })} />
      </div>
      <button className="iconbtn" onClick={() => mesoActionsSheet(meso)} aria-label={t('More')}><Icon name="more" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ alignItems: 'center' }}>
        <span className={'tag' + (active ? ' acc' : '')}>{t(active ? 'Active' : 'Not active')}</span>
        <span className="small dim">{fmtDate(meso.start)} → {fmtDate(meso.end)} · {t('{0} weeks', weeks.length)}</span>
      </div>
      <div style={{ margin: '14px 0 12px' }}>
        <Segmented
          options={weeks.map(x => ({ value: x.n, label: (x.log ? '✓ ' : '') + 'S' + x.n }))}
          value={w.n}
          onChange={setSel}
        />
      </div>
      <div className="small"><b>{w.phase}</b> · {fmtDate(w.start)} → {fmtDate(w.end)}{w.n === current?.n ? ' · ' + t('this week') : ''}</div>
      <div className="dim small" style={{ marginTop: 8 }}>
        {active && meso.activatedBy
          ? t('Active since {0}', fmtDate(String(meso.activatedAt || '').slice(0, 10))) + ' · ' +
            t(meso.activatedBy === 'assistant' ? 'activated by the assistant' : 'activated by you')
          : t(meso.origin === 'assistant' ? 'mesocycle from the assistant' : 'your mesocycle')}
      </div>
    </div>

    <h4 className="sec">{t('THIS WEEK')}</h4>
    <div className="sect-b">
      {w.plan && <div className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
        <div className="lrow-m">
          <div className="lrow-t" style={{ fontSize: 13.5, color: 'var(--label-2)' }}>{t('Planned')}</div>
          <div className="lrow-s" style={{ color: 'var(--label)' }}>{w.plan}</div>
        </div></div>}
      {w.log && <div className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
        <div className="lrow-m">
          <div className="lrow-t" style={{ fontSize: 13.5, color: 'var(--label-2)' }}>{t('Logged')}</div>
          <div className="lrow-s" style={{ color: 'var(--label)' }}>{w.log}</div>
        </div></div>}
      {!w.plan && !w.log && <div className="lrow" style={{ cursor: 'default' }}>
        <div className="lrow-m"><div className="lrow-s">{t('Nothing planned or logged for this week yet.')}</div></div></div>}
    </div>

    {meso.goal && <>
      <h4 className="sec">{t('OBJECTIVE')}</h4>
      <div className="card"><div className="small" style={{ lineHeight: 1.5 }}>{meso.goal}</div></div>
    </>}

    {meso.priorities && Object.keys(meso.priorities).length > 0 && <>
      <h4 className="sec">{t('PRIORITIES')}</h4>
      <div className="sect-b">
        {['lower', 'upper'].filter(k => meso.priorities[k]).map(k => {
          const [head, rest] = headAndRest(meso.priorities[k])
          return <div key={k} className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
            <b className="small dim" style={{ minWidth: 52, paddingTop: 2 }}>{t(k === 'lower' ? 'Lower' : 'Upper')}</b>
            <div className="lrow-m"><div className="small" style={{ lineHeight: 1.45 }}><b>{head}</b>{rest}</div></div>
          </div>
        })}
      </div>
    </>}

    {rules.length > 0 && <>
      <h4 className="sec">{t('RULES')}</h4>
      <div className="sect-b">
        {shownRules.map(([k, v]) => <div key={k} className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
          <b className="small" style={{ minWidth: 104, fontWeight: 500 }}>{k}</b>
          <div className="lrow-m"><div className="small dim" style={{ lineHeight: 1.45 }}>{v}</div></div>
        </div>)}
        {rules.length > 3 && <div className="lrow tap" onClick={() => toggle('rules')}>
          <div className="lrow-m"><div className="lrow-t" style={{ color: 'var(--acc)', fontSize: 15 }}>
            {open.rules ? t('Show less') : t('Show all ({0})', rules.length)}</div></div>
        </div>}
      </div>
    </>}

    {meso.evidence && <>
      <h4 className="sec">{t('EVIDENCE')}</h4>
      <div className="sect-b">
        <div className={'lrow tap' + (open.evidence ? ' open' : '')} onClick={() => toggle('evidence')}>
          <div className="lrow-m"><div className="lrow-t" style={{ fontSize: 15 }}>{t('Why this mesocycle')}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
        {open.evidence && <div style={{ padding: '0 14px 14px' }}><div className="small dim" style={{ lineHeight: 1.5 }}>{meso.evidence}</div></div>}
      </div>
    </>}

    {Array.isArray(meso.log) && meso.log.length > 0 && <>
      <h4 className="sec">{t('COACH LOG')}</h4>
      <div className="sect-b">
        <div className={'lrow tap' + (open.log ? ' open' : '')} onClick={() => toggle('log')}>
          <div className="lrow-m"><div className="lrow-t" style={{ fontSize: 15 }}>{t('{0} entries', meso.log.length)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
        {open.log && meso.log.map((e, i) => <div key={i} className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
          <b className="small dim" style={{ minWidth: 52, paddingTop: 2 }}>{fmtDate(String(e.date || '').slice(0, 10))}</b>
          <div className="lrow-m"><div className="small dim" style={{ lineHeight: 1.45 }}>{e.text}</div></div>
        </div>)}
      </div>
    </>}

    {extras.length > 0 && <>
      <h4 className="sec">{t('EXTRAS')}</h4>
      <div className="sect-b">
        <div className={'lrow tap' + (open.extras ? ' open' : '')} onClick={() => toggle('extras')}>
          <div className="lrow-m">
            <div className="lrow-t" style={{ fontSize: 15 }}>{t('{0} fields from your file', extras.length)}</div>
            <div className="lrow-s">{t('kept as they came — nothing was rewritten')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
        {open.extras && extras.map(([k, v]) => <div key={k} className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
          <b className="small" style={{ minWidth: 104, fontWeight: 500 }}>{k}</b>
          <div className="lrow-m">
            {/* Objeto aninhado sai indentado, no mesmo monoespaçado da visão crua: um
                `JSON.stringify` de uma linha só esconde a estrutura e estoura a largura. */}
            {v !== null && typeof v === 'object'
              ? <pre className="rawjson" style={{ margin: 0 }}>{JSON.stringify(v, null, 2)}</pre>
              : <div className="small dim" style={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>{String(v)}</div>}
          </div>
        </div>)}
      </div>
    </>}

    <div style={{ height: 12 }} />
    {!active
      ? <Button variant="primary" icon="check" onClick={activate}>{t('Activate this mesocycle')}</Button>
      : <Button variant="tinted" icon="pencil" onClick={() => mesoFormSheet({ meso })}>{t('Edit')}</Button>}
    {!active && <><div style={{ height: 8 }} />
      <Button variant="ghost" icon="pencil" onClick={() => mesoFormSheet({ meso })}>{t('Edit')}</Button></>}
  </>
}
