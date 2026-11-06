// Minutos inteiros que faltam, nunca negativos. Puro, para o teste.
export const minutesLeft = (expiresAt, now = Date.now()) => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60000))
