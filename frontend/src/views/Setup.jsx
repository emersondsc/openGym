// Pré-início: 4 etapas obrigatórias de uma conta nova (sexo, idioma, unidade, estilo) antes da
// primeira home. O Shell mostra esta tela no lugar das rotas enquanto user.setupPending for verdadeiro.
// O rascunho fica só aqui; idioma e estilo valem na tela como prévia (useUI.setupPreview).
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { SKINS } from '../lib/format.js'
import { STEPS, initialDraft, summaryOf, finishSetup } from '../lib/setup.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import StylePreview from '../components/StylePreview.jsx'

// Grupo de opções acessível: role=radiogroup, roving tabindex (só a marcada tem tabIndex 0),
// setas trocam a opção marcada, Enter e Espaço marcam a opção em foco (o clique nativo do botão).
function RadioGroup({ label, value, options, onChange, disabled, className = 'setup-opts', renderOpt }) {
  const refs = useRef([])
  const idx = Math.max(0, options.findIndex(o => o.value === value))
  const move = (e, i) => {
    const k = e.key
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(k)) return
    e.preventDefault()
    const d = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1
    const n = (i + d + options.length) % options.length
    onChange(options[n].value)
    refs.current[n]?.focus()
  }
  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((o, i) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={i === idx ? 0 : -1} disabled={disabled} aria-disabled={disabled || undefined}
          ref={el => { refs.current[i] = el }}
          className={renderOpt ? 'pv-card-btn' + (o.value === value ? ' on' : '') : 'setup-opt'}
          onClick={() => onChange(o.value)} onKeyDown={e => move(e, i)}>
          {renderOpt ? renderOpt(o, o.value === value) : <>{o.label}{o.sub && <small>{o.sub}</small>}</>}
        </button>
      ))}
    </div>
  )
}

export default function Setup() {
  const navigate = useNavigate()
  const { S, update, pushState, setUser } = useStore()
  const setSetupPreview = useUI(s => s.setSetupPreview)
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(() => initialDraft(S))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const head = useRef(null)

  // Prévia: idioma e estilo valem na tela já. A limpeza (desmontagem) é o único lugar que zera.
  useEffect(() => { setSetupPreview({ lang: draft.lang, skin: draft.skin }) }, [draft.lang, draft.skin])
  useEffect(() => () => setSetupPreview(null), [])
  // Ao trocar de etapa, o foco vai para o título (leitor de tela e teclado começam do topo).
  useEffect(() => { head.current?.focus() }, [step])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))
  const key = STEPS[step]
  const last = step === STEPS.length - 1

  const start = async () => {
    setError(false)
    setBusy(true)
    try {
      const user = await finishSetup({ update, pushState, api }, draft)
      // Navegar antes do setUser: enquanto pendente, o Shell mostra esta tela em qualquer rota; o
      // setUser desmonta esta tela e a home já está na URL.
      navigate('/home')
      setUser(user)
    } catch {
      setBusy(false)
      setError(true)
    }
  }

  let title, sub, body
  if (key === 'body') {
    title = t('Which body diagram do you want to see?')
    sub = t('Only used to draw the muscles you trained.')
    body = <RadioGroup label={title} value={draft.body} disabled={busy} onChange={v => set('body', v)}
      options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} />
  } else if (key === 'lang') {
    title = t('Language')
    sub = t('Choose the language of the app.')
    body = <RadioGroup label={title} value={draft.lang} disabled={busy} onChange={v => set('lang', v)}
      options={Object.entries(LANGS).map(([k, name]) => ({
        value: k, label: name,
        sub: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
      }))} />
  } else if (key === 'unit') {
    title = t('Weight unit')
    sub = t('You can change it later in Settings. Switching does not convert numbers already logged.')
    body = <RadioGroup label={title} value={draft.unit} disabled={busy} onChange={v => set('unit', v)}
      options={[{ value: 'kg', label: t('Kilograms (kg)') }, { value: 'lb', label: t('Pounds (lb)') }]} />
  } else {
    title = t('Choose your style')
    sub = t('You can switch anytime in Settings.')
    body = <>
      <div className="pv-bleed">
        <RadioGroup label={title} value={draft.skin} disabled={busy} onChange={v => set('skin', v)} className="pv-track"
          options={Object.entries(SKINS).map(([k, sk]) => ({ value: k, sk }))}
          renderOpt={(o, on) => <>
            <StylePreview skin={o.value} />
            <span className="pv-name">{o.sk.label}{on && <Icon name="check" />}</span>
            <span className="pv-desc">{t(o.sk.subtitle)}</span>
          </>} />
      </div>
      <div className="setup-sum">{summaryOf(draft)}</div>
    </>
  }

  return (
    <div className="setup">
      <div className="setup-step">{t('Step {0} of 4', step + 1)}</div>
      <h2 ref={head} tabIndex={-1}>{title}</h2>
      <div className="setup-sub">{sub}</div>
      {body}
      {last && error && <div className="setup-err" role="alert">{t('Could not save. Check your connection.')}</div>}
      <div className="setup-nav">
        {step > 0 && <Button variant="plain" disabled={busy} aria-disabled={busy || undefined}
          onClick={() => setStep(s => s - 1)}>{t('Back')}</Button>}
        {!last
          ? <Button variant="primary" onClick={() => setStep(s => s + 1)}>{t('Continue')}</Button>
          : <Button variant="primary" disabled={busy} aria-disabled={busy || undefined} aria-busy={busy || undefined}
              onClick={start}>{error ? t('Try again') : t('Start')}</Button>}
      </div>
    </div>
  )
}
