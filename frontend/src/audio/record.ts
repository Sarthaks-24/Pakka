export interface Recorder {
  stop: () => Promise<{ blob: Blob; ms: number }>
}

/** Opens the microphone and starts recording. Throws if access is denied. */
export async function startRecorder(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const chunks: Blob[] = []
  let media: MediaRecorder
  let startedAt: number
  try {
    media = new MediaRecorder(stream)
    media.ondataavailable = (e) => chunks.push(e.data)
    startedAt = performance.now()
    media.start()
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop())
    throw e
  }
  return {
    stop: () =>
      new Promise((resolve) => {
        media.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve({ blob: new Blob(chunks, { type: media.mimeType }), ms: performance.now() - startedAt })
        }
        media.stop()
      }),
  }
}

export const micDenied = (e: unknown) => e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
