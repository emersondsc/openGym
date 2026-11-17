import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useDiet } from '../store/useDiet.js'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { formatRangeOrNumber, makeDietId, summarizeDietPlan } from '../lib/diet.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Switch, TextArea, TextField } from '../components/ui.jsx'

const numOrVal = v => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && typeof v.min === 'number' && typeof v.max === 'number') {
    return Math.round((v.min + v.max) / 2)
  }
  return ''
}

const mealItemsToText = items => (Array.isArray(items) ? items.map(formatMealItem).filter(Boolean).join('\n') : '')

function DietPlanSheet({ initialPlan = null, isActive = false, close }) {
  const toast = useUI(s => s.toast)
  const savePlan = useDiet(s => s.savePlan)
  const isEdit = !!initialPlan

  const targets = initialPlan?.targets || {}
  const macros = targets.macros || {}
  const [name, setName] = useState(initialPlan?.name || '')
  const [goal, setGoal] = useState(initialPlan?.goal || '')
  const [kcal, setKcal] = useState(numOrVal(targets.dailyKcal) || 2200)
  const [proteinG, setProteinG] = useState(numOrVal(macros.proteinG) || 150)
  const [carbsG, setCarbsG] = useState(numOrVal(macros.carbsG) || 200)
  const [fatG, setFatG] = useState(numOrVal(macros.fatG) || 70)
  const [fiberG, setFiberG] = useState(numOrVal(macros.fiberG) || 30)
  const [notes, setNotes] = useState(
    Array.isArray(initialPlan?.notes) ? initialPlan.notes.join('\n') : (initialPlan?.notes || '')
  )
  const [meals, setMeals] = useState(() => (
    Array.isArray(initialPlan?.meals) && initialPlan.meals.length
      ? initialPlan.meals.map((m, i) => ({
          id: m.id || `meal-${i + 1}`,
          name: m.name || '',
          time: m.time || '',
          kcal: numOrVal(m.kcal),
          itemsText: mealItemsToText(m.items)
        }))
      : [{ id: 'meal-1', name: t('Main meal'), time: '12:30', kcal: 700, itemsText: '' }]
  ))
  const [activateNow, setActivateNow] = useState(!isEdit || isActive)
  const [saving, setSaving] = useState(false)

  const updateMeal = (idx, patch) => {
    setMeals(list => list.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }

  const addMeal = () => {
    setMeals(list => [
      ...list,
      { id: `meal-${list.length + 1}-${Date.now().toString(36).slice(-3)}`, name: '', time: '', kcal: '', itemsText: '' }
    ])
  }

  const removeMeal = idx => {
    setMeals(list => list.filter((_, i) => i !== idx))
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast(t('Enter a name'))
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const cleanedMeals = meals
      .filter(m => m.name.trim())
      .map((m, i) => {
        const items = m.itemsText.split('\n').map(s => s.trim()).filter(Boolean)
        const out = { id: m.id || `meal-${i + 1}`, name: m.name.trim() }
        if (m.time.trim()) out.time = m.time.trim()
        if (m.kcal !== '' && Number.isFinite(Number(m.kcal)) && Number(m.kcal) >= 0) out.kcal = Number(m.kcal)
        if (items.length) out.items = items
        return out
      })

    const nextTargets = {
      ...(initialPlan?.targets || {}),
      dailyKcal: Number(kcal) || 0,
      macros: {
        ...(initialPlan?.targets?.macros || {}),
        proteinG: Number(proteinG) || 0,
        carbsG: Number(carbsG) || 0,
        fatG: Number(fatG) || 0,
        fiberG: Number(fiberG) || 0
      }
    }
    delete nextTargets.dailyKcalMin
    delete nextTargets.dailyKcalMax

    const planPayload = {
      ...(initialPlan || {}),
      id: initialPlan?.id || makeDietId(trimmed, today),
      name: trimmed,
      referenceDate: initialPlan?.referenceDate || today,
      origin: initialPlan?.origin === 'assistant' ? 'assistant' : 'user',
      targets: nextTargets,
      meals: cleanedMeals
    }
    if (goal.trim()) planPayload.goal = goal.trim()
    else delete planPayload.goal

    if (notes.trim()) planPayload.notes = notes.trim()
    else delete planPayload.notes

    setSaving(true)
    try {
      await savePlan(planPayload, { activate: activateNow ? 'now' : 'none' })
      toast(t('Diet plan saved'))
      close()
    } catch (e) {
      toast(e.message || t('Could not save diet plan'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <h3>{t(isEdit ? 'Edit diet plan' : 'New diet plan')}</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        <TextField
          placeholder={t('Plan name')}
          value={name}
          onChange={e => setName(e.target.value)}
          aria-label={t('Plan name')}
        />
        <TextField
          placeholder={t('Goal (optional)')}
          value={goal}
          onChange={e => setGoal(e.target.value)}
          aria-label={t('Goal (optional)')}
        />
        <div className="grid2">
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Daily kcal')}</div>
            <NumberField value={kcal} decimal={false} onChange={setKcal} aria-label={t('Daily kcal')} />
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Protein (g)')}</div>
            <NumberField value={proteinG} decimal={false} onChange={setProteinG} aria-label={t('Protein (g)')} />
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Carbs (g)')}</div>
            <NumberField value={carbsG} decimal={false} onChange={setCarbsG} aria-label={t('Carbs (g)')} />
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Fat (g)')}</div>
            <NumberField value={fatG} decimal={false} onChange={setFatG} aria-label={t('Fat (g)')} />
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Fiber (g)')}</div>
            <NumberField value={fiberG} decimal={false} onChange={setFiberG} aria-label={t('Fiber (g)')} />
          </div>
        </div>

        <div className="row between" style={{ marginTop: 4 }}>
          <span className="small muted">{t('Meals')}</span>
          <Button size="xs" variant="tinted" icon="plus" onClick={addMeal}>{t('Add meal')}</Button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {meals.map((m, idx) => (
            <div key={m.id || idx} className="card" style={{ marginBottom: 0, padding: 10, display: 'grid', gap: 8 }}>
              <div className="row" style={{ gap: 6 }}>
                <TextField
                  placeholder={t('Meal name')}
                  value={m.name}
                  onChange={e => updateMeal(idx, { name: e.target.value })}
                  aria-label={t('Meal name')}
                />
                <Button size="xs" variant="danger" icon="trash" aria-label={t('Delete')} onClick={() => removeMeal(idx)} />
              </div>
              <div className="grid2">
                <TextField
                  placeholder={t('Time (e.g. 07:30)')}
                  value={m.time}
                  onChange={e => updateMeal(idx, { time: e.target.value })}
                  aria-label={t('Time')}
                />
                <NumberField
                  placeholder={t('Calories (kcal)')}
                  value={m.kcal}
                  decimal={false}
                  onChange={v => updateMeal(idx, { kcal: v })}
                  aria-label={t('Calories (kcal)')}
                />
              </div>
              <TextArea
                placeholder={t('Meal items (one per line)')}
                value={m.itemsText}
                onChange={e => updateMeal(idx, { itemsText: e.target.value })}
                rows={2}
                aria-label={t('Meal items (one per line)')}
              />
            </div>
          ))}
        </div>

        <TextArea
          placeholder={t('Notes (optional)')}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          aria-label={t('Notes (optional)')}
        />

        {(!isEdit || !isActive) && (
          <div className="sect-b">
            <div className="lrow">
              <span className="lrow-m">
                <span className="lrow-t">{t('Activate it now?')}</span>
              </span>
              <Switch checked={activateNow} onChange={setActivateNow} />
            </div>
          </div>
        )}

        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <Button variant="ghost" onClick={close} disabled={saving}>{t('Cancel')}</Button>
          <Button variant="primary" icon="check" onClick={submit} disabled={saving}>{t('Save')}</Button>
        </div>
      </div>
    </>
  )
}

function DeleteDietSheet({ plan, close }) {
  const toast = useUI(s => s.toast)
  const deletePlan = useDiet(s => s.deletePlan)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await deletePlan(plan.id)
      toast(t('{0} deleted', plan.name))
      close()
    } catch (e) {
      toast(e.message || t('Could not delete diet plan'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h3>{t('Delete diet plan?')}</h3>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {plan.name}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button variant="ghost" onClick={close} disabled={busy}>{t('Cancel')}</Button>
        <Button variant="danger" icon="trash" onClick={confirm} disabled={busy}>{t('Delete')}</Button>
      </div>
    </>
  )
}

function formatMealItem(item) {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return ''
  const label = item.food || item.name || ''
  if (item.amount == null) return label
  const qty = `${item.amount}${item.unit ? ' ' + item.unit : ''}`
  return label ? `${label} — ${qty}` : qty
}

export default function Diet() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { store, loading, error, mode, load, activatePlan, loadSamplePlans } = useDiet()
  const [openRules, setOpenRules] = useState(true)
  const [openTips, setOpenTips] = useState(false)
  const [busyId, setBusyId] = useState(null)

  useEffect(() => {
    load().catch(() => {})
  }, [user?.id, load])

  const plans = store.plans || []
  const activePlan = plans.find(p => p.id === store.activePlanId) || null
  const summary = summarizeDietPlan(activePlan)
  const rules = Object.entries(activePlan?.rules || {})
  const tips = Array.isArray(activePlan?.executionTips)
    ? activePlan.executionTips
    : (typeof activePlan?.executionTips === 'string' ? [activePlan.executionTips] : [])
  const notesList = Array.isArray(activePlan?.notes)
    ? activePlan.notes
    : (typeof activePlan?.notes === 'string' && activePlan.notes.trim() ? [activePlan.notes] : [])

  const handleActivate = async id => {
    setBusyId(id)
    try {
      const next = await activatePlan(id)
      const picked = (next.plans || []).find(p => p.id === id)
      if (picked) toast(t('{0} is now your diet plan', picked.name))
    } catch (e) {
      toast(e.message || t('Could not activate diet plan'))
    } finally {
      setBusyId(null)
    }
  }

  const handleLoadSample = async () => {
    setBusyId('__sample__')
    try {
      const { added } = await loadSamplePlans()
      toast(added > 0 ? t('Sample diet plans loaded') : t('Sample plans already loaded'))
    } catch (e) {
      toast(e.message || t('Could not save diet plan'))
    } finally {
      setBusyId(null)
    }
  }

  const openPlanForm = (initialPlan = null, isActive = false) => {
    openSheet(close => <DietPlanSheet initialPlan={initialPlan} isActive={isActive} close={close} />)
  }

  const openDeleteConfirm = plan => {
    openSheet(close => <DeleteDietSheet plan={plan} close={close} />)
  }

  return (
    <>
      <div className="hdr">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}>
            <Icon name="chevronLeft" />
          </button>
          <div style={{ minWidth: 0 }}>
            <h1>{t('Diet')}</h1>
            <div className="sub">{t('Nutrition plan')}</div>
          </div>
        </div>
        <Button size="sm" variant="tinted" icon="plus" onClick={() => openPlanForm(null, true)}>
          {t('New')}
        </Button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="small muted">{error}</div>
          <div style={{ height: 8 }} />
          <Button size="xs" variant="tinted" onClick={() => load(true).catch(() => {})}>{t('Retry')}</Button>
        </div>
      )}

      {loading && !plans.length && (
        <div className="card small muted" style={{ marginBottom: 12 }}>{t('Loading...')}</div>
      )}

      {activePlan ? (
        <>
          <div className="card">
            <div className="row between" style={{ alignItems: 'center', marginBottom: 8 }}>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className="tag acc">{t('Active')}</span>
                {activePlan.origin === 'assistant' && <span className="tag">{t('Coach')}</span>}
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                {activePlan.referenceDate && (
                  <span className="small dim">{fmtDate(activePlan.referenceDate)}</span>
                )}
                <Button size="xs" variant="ghost" icon="pencil" onClick={() => openPlanForm(activePlan, true)}>
                  {t('Edit')}
                </Button>
              </div>
            </div>

            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.02em', lineHeight: 1.25 }}>
              {activePlan.name}
            </div>
            {activePlan.goal && (
              <div className="small muted" style={{ marginTop: 6, lineHeight: 1.45 }}>
                {activePlan.goal}
              </div>
            )}

            <div className="divider" />

            <div className="grid2">
              <div>
                <div className="small dim">{t('Daily target')}</div>
                <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--acc)', marginTop: 2 }}>
                  {summary.kcal || '—'}
                </div>
                {summary.deficit && (
                  <div className="small muted" style={{ marginTop: 2 }}>
                    {t('Deficit')}: {summary.deficit}
                  </div>
                )}
              </div>
              <div>
                <div className="small dim">{t('Energy balance')}</div>
                <div className="small" style={{ marginTop: 4, lineHeight: 1.45 }}>
                  {activePlan.targets?.tdeeKcal != null && (
                    <div>TDEE: <b>{activePlan.targets.tdeeKcal} kcal</b></div>
                  )}
                  {activePlan.targets?.bmrKcal != null && (
                    <div>BMR: <b>{activePlan.targets.bmrKcal} kcal</b></div>
                  )}
                  {activePlan.targets?.expectedWeeklyLossKg != null && (
                    <div className="muted">
                      {t('Est. loss')}: {formatRangeOrNumber(activePlan.targets.expectedWeeklyLossKg, ' kg/sem')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {(summary.protein || summary.carbs || summary.fat || summary.fiber) && (
              <>
                <div className="divider" />
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {summary.protein && <span className="tag acc nocap">{t('Protein')}: {summary.protein}</span>}
                  {summary.carbs && <span className="tag nocap">{t('Carbs')}: {summary.carbs}</span>}
                  {summary.fat && <span className="tag nocap">{t('Fat')}: {summary.fat}</span>}
                  {summary.fiber && <span className="tag nocap">{t('Fiber')}: {summary.fiber}</span>}
                </div>
              </>
            )}

            {activePlan.activatedBy === 'assistant' && store.prevPlanId && (
              <div className="sect-f" style={{ marginTop: 10 }}>
                <span className="tag acc">{t('Activated by the assistant')}</span>{' '}
                <a onClick={() => handleActivate(store.prevPlanId)}>{t('Back to the previous one')}</a>
              </div>
            )}
          </div>

          {Array.isArray(activePlan.meals) && activePlan.meals.length > 0 && (
            <>
              <div className="row between" style={{ marginTop: 22, marginBottom: 8 }}>
                <h4 className="sec" style={{ margin: 0 }}>{t('Meals')}</h4>
                <span className="small dim">{t('{0} meals', activePlan.meals.length)}</span>
              </div>
              <div className="list">
                {activePlan.meals.map((meal, idx) => (
                  <div key={meal.id || idx} className="card" style={{ marginBottom: 0, padding: '12px 14px' }}>
                    <div className="row between" style={{ alignItems: 'center' }}>
                      <div style={{ fontWeight: 600, fontSize: 16 }}>
                        {meal.name}
                        {meal.time && <span className="small dim" style={{ fontWeight: 400, marginLeft: 8 }}>{meal.time}</span>}
                      </div>
                      {meal.kcal != null && (
                        <span className="tag acc nocap">{formatRangeOrNumber(meal.kcal, ' kcal')}</span>
                      )}
                    </div>
                    {Array.isArray(meal.items) && meal.items.length > 0 && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 14, lineHeight: 1.45, color: 'var(--label-2)' }}>
                        {meal.items.map((it, j) => (
                          <li key={j}>{formatMealItem(it)}</li>
                        ))}
                      </ul>
                    )}
                    {meal.notes && (
                      <div className="small dim" style={{ marginTop: 6, lineHeight: 1.4 }}>{meal.notes}</div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {rules.length > 0 && (
            <>
              <button
                onClick={() => setOpenRules(v => !v)}
                aria-expanded={openRules}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', margin: '22px 0 8px', padding: 0, textAlign: 'left' }}
              >
                <h4 className="sec" style={{ margin: 0 }}>{t('Adjustment rules')}</h4>
                <Icon name={openRules ? 'chevronUp' : 'chevronDown'} style={{ color: 'var(--label-3)', fontSize: 16, marginRight: 4 }} />
              </button>
              {openRules && (
                <div className="sect-b">
                  {rules.map(([k, v]) => (
                    <div key={k} className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
                      <b className="small" style={{ minWidth: 112, fontWeight: 500 }}>{k}</b>
                      <div className="lrow-m">
                        <div className="small dim" style={{ lineHeight: 1.45 }}>{v}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tips.length > 0 && (
            <>
              <button
                onClick={() => setOpenTips(v => !v)}
                aria-expanded={openTips}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', margin: '22px 0 8px', padding: 0, textAlign: 'left' }}
              >
                <h4 className="sec" style={{ margin: 0 }}>{t('Execution tips')}</h4>
                <Icon name={openTips ? 'chevronUp' : 'chevronDown'} style={{ color: 'var(--label-3)', fontSize: 16, marginRight: 4 }} />
              </button>
              {openTips && (
                <div className="sect-b">
                  {tips.map((tip, i) => (
                    <div key={i} className="lrow" style={{ alignItems: 'flex-start', cursor: 'default' }}>
                      <div className="lrow-m">
                        <div className="small dim" style={{ lineHeight: 1.45 }}>{tip}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {notesList.length > 0 && (
            <>
              <h4 className="sec" style={{ marginTop: 22, marginBottom: 8 }}>{t('Notes')}</h4>
              <div className="card">
                {notesList.map((n, i) => (
                  <div key={i} className="small dim" style={{ lineHeight: 1.45 }}>{n}</div>
                ))}
              </div>
            </>
          )}
        </>
      ) : !loading && (
        <div className="empty">
          <div className="ico"><Icon name="clipboard" /></div>
          {t('No active diet plan.')}
          <br />
          {plans.length ? t('Activate one below or create a new plan.') : t('Create a plan or load a sample to start.')}
        </div>
      )}

      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Diet plans')}</h4>
        <div className="row" style={{ gap: 8 }}>
          <Button size="xs" variant="ghost" icon="sparkles" onClick={handleLoadSample} disabled={busyId === '__sample__'}>
            {t('Load sample')}
          </Button>
          <span className="small dim">{plans.length}</span>
        </div>
      </div>

      {plans.length > 0 ? (
        <div className="list">
          {plans.map(p => {
            const isActive = p.id === store.activePlanId
            const s = summarizeDietPlan(p)
            return (
              <div key={p.id} className="item" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <span className="tt">{p.name}</span>
                    {isActive && <span className="tag acc">{t('Active')}</span>}
                  </div>
                  <div className="ss">{s.summaryLine || p.goal || t('No macro targets')}</div>
                </div>
                <div className="row" style={{ gap: 6, flex: 'none' }}>
                  {!isActive && (
                    <Button size="xs" variant="tinted" onClick={() => handleActivate(p.id)} disabled={busyId === p.id}>
                      {t('Activate')}
                    </Button>
                  )}
                  <Button size="xs" variant="ghost" icon="pencil" aria-label={t('Edit')} onClick={() => openPlanForm(p, isActive)} />
                  <Button
                    size="xs"
                    variant="danger"
                    icon="trash"
                    aria-label={t('Delete')}
                    onClick={() => openDeleteConfirm(p)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      ) : !loading && (
        <div className="card">
          <div className="small muted" style={{ marginBottom: 10 }}>{t('No diet plans yet.')}</div>
          <div className="row" style={{ gap: 8 }}>
            <Button size="sm" variant="primary" icon="plus" onClick={() => openPlanForm(null, true)}>
              {t('New diet plan')}
            </Button>
            <Button size="sm" variant="ghost" icon="sparkles" onClick={handleLoadSample} disabled={busyId === '__sample__'}>
              {t('Load sample')}
            </Button>
          </div>
        </div>
      )}

      {mode === 'local' && (
        <div className="sect-f" style={{ marginTop: 12 }}>
          {t('Saved locally on this device (guest/demo mode).')}
        </div>
      )}
    </>
  )
}
