import { describe, expect, it } from 'vitest'
import { isEditableTarget } from './useEditorShortcuts'

const el = (html: string): Element => {
  const host = document.createElement('div')
  host.innerHTML = html
  const first = host.firstElementChild
  if (!first) throw new Error(`no element in ${html}`)
  return first
}

describe('isEditableTarget', () => {
  it('is true for an input', () => {
    expect(isEditableTarget(el('<input />'))).toBe(true)
  })

  it('is true for a textarea', () => {
    expect(isEditableTarget(el('<textarea></textarea>'))).toBe(true)
  })

  it('is true for a select', () => {
    expect(isEditableTarget(el('<select><option>a</option></select>'))).toBe(true)
  })

  it('is true for a contentEditable element', () => {
    expect(isEditableTarget(el('<div contenteditable="true"></div>'))).toBe(true)
    expect(isEditableTarget(el('<div contenteditable=""></div>'))).toBe(true)
  })

  it('is true for a node nested inside a contentEditable region', () => {
    const region = el('<div contenteditable="true"><span>deep</span></div>')
    expect(isEditableTarget(region.querySelector('span'))).toBe(true)
  })

  it('is false for contenteditable="false"', () => {
    expect(isEditableTarget(el('<div contenteditable="false"></div>'))).toBe(false)
  })

  it('is false for ordinary elements', () => {
    expect(isEditableTarget(el('<div></div>'))).toBe(false)
    expect(isEditableTarget(el('<button>go</button>'))).toBe(false)
    expect(isEditableTarget(el('<svg><rect /></svg>').firstElementChild)).toBe(false)
  })

  it('is false for a null target or a non-element event target', () => {
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(window)).toBe(false)
  })
})
