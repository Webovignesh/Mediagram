export type AppError = Error & { status: number, retryAfter?: number }

/** The one way to raise a user-facing error; `message` is shown as is (ARCHITECTURE > Bridge). */
export const fail = (status: number, message: string, extra?: { retryAfter?: number }): AppError =>
  Object.assign(new Error(message), { status }, extra)
