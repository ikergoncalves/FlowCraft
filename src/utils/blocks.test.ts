import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOCK_SIZE, makeBlockAt } from './blocks'

describe('makeBlockAt', () => {
  it('centres the block on the given world point', () => {
    const block = makeBlockAt('rect', { x: 100, y: 200 })
    const size = DEFAULT_BLOCK_SIZE.rect

    expect(block.x + block.width / 2).toBe(100)
    expect(block.y + block.height / 2).toBe(200)
    expect(block).toMatchObject(size)
  })

  it('gives each type its own default size', () => {
    expect(makeBlockAt('text', { x: 0, y: 0 })).toMatchObject(DEFAULT_BLOCK_SIZE.text)
    expect(DEFAULT_BLOCK_SIZE.text).not.toEqual(DEFAULT_BLOCK_SIZE.rect)
  })

  it('carries the type through and seeds placeholder text', () => {
    const block = makeBlockAt('text', { x: -40, y: -40 })
    expect(block.type).toBe('text')
    expect(block.text.length).toBeGreaterThan(0)
  })

  it('handles negative world coordinates', () => {
    const block = makeBlockAt('rect', { x: -500, y: -250 })
    expect(block.x).toBeLessThan(0)
    expect(block.x + block.width / 2).toBe(-500)
    expect(block.y + block.height / 2).toBe(-250)
  })
})
