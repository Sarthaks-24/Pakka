import { describe, expect, it } from 'vitest'
import { encodeWav } from './wav'

const tag = (v: DataView, at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(at + i)))

describe('encodeWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1])
  const view = new DataView(encodeWav(samples))

  it('writes a RIFF/WAVE header for 16 kHz mono 16-bit PCM', () => {
    expect(tag(view, 0)).toBe('RIFF')
    expect(tag(view, 8)).toBe('WAVE')
    expect(tag(view, 12)).toBe('fmt ')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(28, true)).toBe(32000)
    expect(view.getUint16(34, true)).toBe(16)
  })

  it('records the data length and total size', () => {
    expect(tag(view, 36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(samples.length * 2)
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2)
    expect(view.byteLength).toBe(44 + samples.length * 2)
  })

  it('clamps and scales samples to 16-bit', () => {
    expect(view.getInt16(44 + 3 * 2, true)).toBe(32767)
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-32768)
  })
})
