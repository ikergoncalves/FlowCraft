import { describe, expect, it } from 'vitest'
import { createId } from './id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('createId', () => {
  it('returns a v4 UUID', () => {
    expect(createId()).toMatch(UUID_V4)
  })

  it('never repeats across a large batch', () => {
    const ids = Array.from({ length: 2000 }, () => createId())
    expect(new Set(ids).size).toBe(ids.length)
  })
})
