// Partes puras da tela do treinador no chat, para o teste.

// Minutos inteiros que faltam, nunca negativos.
export const minutesLeft = (expiresAt, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60000))

/** Em que passo a tela está: loading, linked, code, ready (ativado ou dono) ou activate. */
export function coachStage(info, code) {
  if (info === undefined) return 'loading'
  if (info?.linked) return 'linked'
  if (code) return 'code'
  if (info?.allowed || info?.owner) return 'ready'
  return 'activate'
}

const ERROS = {
  INVALID_EMAIL: 'Check the e-mail address.',
  EMAIL_IN_USE: 'This e-mail is already used by another account.',
  PASSKEY_REFUSED: 'The passkey was not confirmed. Try again.'
}
/** Texto para o aviso: mensagem conhecida pelo código da API, senão a da própria API. */
export const errorText = (e, t) => (ERROS[e?.code] ? t(ERROS[e.code]) : (e?.message || t('Could not load')))
