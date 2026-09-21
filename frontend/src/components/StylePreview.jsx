// Uma tela de Home em miniatura, num estilo, para a vitrine da abertura (StyleIntro).
//
// Nao e a tela real: e um desenho. O que ele NAO desenha e a cor — a paleta vem dos tokens de
// verdade, porque cada bloco de skin no index.css tambem casa com `.skin-prev[data-skin="x"]`.
// Assim a vitrine nunca sai de sincronia com o estilo: mudar um token muda a miniatura junto.
// O que estas classes desenham e so a forma (caixa, regua, caixa-alta, serifa, gradiente).
//
// As classes comecam com `pv-` de proposito: nenhuma delas casa com as regras de skin (que sao
// `:root[data-skin] .card`, `.item`, `#tabbar`...), entao a miniatura de um estilo nunca herda a
// forma do estilo que estiver ativo.
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const BARS = [['Shoulders', 100, '39.4'], ['Upper back', 44, '14.4'], ['Hamstrings', 40, '14.2']]

export default function StylePreview({ skin }) {
  return <div className="skin-prev" data-skin={skin} aria-hidden="true">
    <div className="pv-hdr">
      <b className="pv-h1">Hi emerson</b>
      <span className="pv-date">Sunday 20 September</span>
    </div>
    <div className="pv-week">
      {DAYS.map((d, i) => <div key={d} className={'pv-day' + (i === 6 ? ' today' : '')}>
        <span className="pv-dl">{d}</span>
        <span className="pv-dn">{14 + i}</span>
        <i className={'pv-dot' + (i < 5 ? ' done' : i === 6 ? ' plan' : '')} />
      </div>)}
    </div>
    <div className="pv-today">
      <span className="pv-rail" />
      <span className="pv-tx"><b className="pv-tt">Rest Day</b><span className="pv-ss">30 week streak</span></span>
    </div>
    <div className="pv-card">
      <div className="pv-eyebrow">Weekly volume</div>
      {BARS.map(([nm, w, v]) => <div key={nm} className="pv-row">
        <span>{nm}</span><span className="pv-bar"><i style={{ width: w + '%' }} /></span><b>{v}</b>
      </div>)}
    </div>
    <div className="pv-tabs">
      <span>Home</span><span>Plan</span><span className="pv-start" /><span>Stats</span><span>Ex.</span>
    </div>
  </div>
}
