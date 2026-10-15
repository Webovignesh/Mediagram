/** Pure display formatters, kept out of the UI file so they can be unit tested without a DOM. */
const fmtBase = new Intl.NumberFormat('en', { maximumFractionDigits: 1 })

/** File size. A size that is missing or nonsense reads as nothing rather than "NaN undefined". */
export const fmtBytes = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  // log() of a fraction is negative, which would index past the start of the units.
  const i = Math.max(0, Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1))
  return `${fmtBase.format(n / 1024 ** i)} ${units[i]}`
}

/** Media length: M:SS, and H:MM:SS past an hour. Fractions are rounded away - a duration is read, not measured. */
export const fmtDuration = (s: number) => {
  const total = Number.isFinite(s) ? Math.max(0, Math.round(s)) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
