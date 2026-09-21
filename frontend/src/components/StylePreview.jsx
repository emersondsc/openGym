// Miniatura de uma tela do app num estilo, para a folha de apresentacao (StyleIntro).
//
// Nao e a tela real: e um desenho. O que ele NAO desenha e a cor — a paleta vem dos tokens de
// verdade, porque cada bloco de skin no index.css tambem casa com `.skin-prev[data-skin="x"]`.
// Assim a vitrine nunca sai de sincronia com o estilo: mudar um token muda a miniatura junto.
// O que estas classes desenham e so a forma (caixa, regua, caixa-alta, serifa).
export default function StylePreview({ skin }) {
  return <div className="skin-prev" data-skin={skin} aria-hidden="true">
    <div className="pv-top"><b className="pv-h1">Stats</b><span className="pv-sub">Progress</span></div>
    <div className="pv-card">
      <div className="pv-eyebrow">Muscle balance</div>
      <div className="pv-row"><span>Shoulders</span><span className="pv-bar"><i style={{ width: '100%' }} /></span><b>39.4</b></div>
      <div className="pv-row"><span>Upper back</span><span className="pv-bar"><i style={{ width: '42%' }} /></span><b>14.4</b></div>
    </div>
    <div className="pv-list">
      <div className="pv-item"><b>Legs 2</b><span>39 min</span></div>
      <div className="pv-item"><b>Pull C</b><span>55 min</span></div>
    </div>
  </div>
}
