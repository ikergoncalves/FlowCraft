import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '../theme/stylesheet'
import { MAX_ZOOM, MIN_ZOOM } from '../utils/coords'
import {
  defaultPreferences,
  PREFERENCES_VERSION,
  readPreferences,
  toPreferences,
} from './preferences'

describe('preferences', () => {
  it('round-trips what was written', () => {
    const written = toPreferences('light', false, { x: 10, y: -20, zoom: 2 })
    expect(readPreferences(written)).toEqual(written)
  })

  it('round-trips through JSON', () => {
    const written = toPreferences('dark', true, { x: 0, y: 0, zoom: 1 })
    expect(readPreferences(JSON.parse(JSON.stringify(written)))).toEqual(written)
  })

  it('copies the viewport rather than holding the live one', () => {
    const viewport = { x: 1, y: 2, zoom: 1 }
    const written = toPreferences('dark', true, viewport)
    viewport.x = 999
    expect(written.viewport.x).toBe(1)
  })

  it('never fails, whatever it is handed', () => {
    // The opposite policy to the document's, and for a reason: every field
    // here has an obvious right answer when it is missing, so refusing the
    // record would cost a user their theme over a bad boolean.
    for (const raw of [null, undefined, 7, 'preferences', [], true]) {
      expect(readPreferences(raw)).toEqual(defaultPreferences())
    }
  })

  it('keeps the fields it understands and defaults the rest', () => {
    const result = readPreferences({ theme: 'light', snapToGrid: 'yes' })
    expect(result.theme).toBe('light')
    expect(result.snapToGrid).toBe(defaultPreferences().snapToGrid)
  })

  it('ignores a theme this build has never heard of', () => {
    expect(readPreferences({ theme: 'dracula' }).theme).toBe(DEFAULT_THEME)
    expect(readPreferences({ theme: 42 }).theme).toBe(DEFAULT_THEME)
  })

  it('reads field-wise, so a record from another version still gives what it can', () => {
    // No version gate: a preferences record has nothing that needs migrating,
    // and a strict check would throw away a perfectly good theme.
    const result = readPreferences({ version: 99, theme: 'light', snapToGrid: false })
    expect(result.theme).toBe('light')
    expect(result.snapToGrid).toBe(false)
    expect(result.version).toBe(PREFERENCES_VERSION)
  })

  it('clamps a corrupt zoom into the legal range', () => {
    // The one field that can make the editor look broken rather than merely
    // wrong: at zoom 900 the diagram is off screen and unfindable.
    expect(readPreferences({ viewport: { zoom: 900 } }).viewport.zoom).toBe(MAX_ZOOM)
    expect(readPreferences({ viewport: { zoom: -3 } }).viewport.zoom).toBe(MIN_ZOOM)
    expect(readPreferences({ viewport: { zoom: Number.NaN } }).viewport.zoom).toBe(1)
  })

  it('defaults a coordinate that is not a number', () => {
    const result = readPreferences({ viewport: { x: 'left', y: 40 } })
    expect(result.viewport.x).toBe(0)
    expect(result.viewport.y).toBe(40)
  })

  it('survives a viewport that is not an object', () => {
    expect(readPreferences({ viewport: 'far away' }).viewport).toEqual(
      defaultPreferences().viewport,
    )
  })

  it('carries nothing but the four fields it declares', () => {
    // The list is the decision: no selection, no tool, no clipboard, no
    // history. Anything creeping in here is a session leaking into a file.
    expect(Object.keys(readPreferences({}) as object).sort()).toEqual([
      'snapToGrid',
      'theme',
      'version',
      'viewport',
    ])
  })

  it('drops anything else the record happened to carry', () => {
    const result = readPreferences({ theme: 'light', selectedIds: ['a'], tool: 'rect' })
    expect(result).not.toHaveProperty('selectedIds')
    expect(result).not.toHaveProperty('tool')
  })
})
