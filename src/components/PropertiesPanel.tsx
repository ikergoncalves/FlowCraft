import { useEffect, useId, useRef } from 'react'
import { styleBlocks, styleConnections } from '../history/actions'
import { useBlockList, useConnectionList, useDiagramStore } from '../store/diagramStore'
import type { BlockStyle, ConnectionStyle } from '../types'
import {
  isMixed,
  sharedBlockField,
  sharedConnectionField,
  type Shared,
} from '../utils/style'

/**
 * The preset palette.
 *
 * Small on purpose — eight swatches, one row, no scrolling — with the free
 * picker beside it for anything else. A larger grid is a colour picker in
 * disguise, and a colour picker is what `<input type="color">` already is, for
 * free, with the platform's own accessibility and eyedropper.
 */
const PALETTE: readonly string[] = [
  '#232833',
  '#3b4351',
  '#4c8dff',
  '#3fb984',
  '#e0b341',
  '#e2683c',
  '#d5568f',
  '#e7eaf0',
]

interface SwatchRowProps {
  label: string
  value: Shared<string>
  onPick: (color: string) => void
}

/**
 * A palette row plus a free picker, for one colour field.
 *
 * A divergent selection shows an explicit "Mixed" badge and no active swatch,
 * rather than the first element's colour. `<input type="color">` has no empty
 * state to borrow — it always displays *something* — so the badge is the only
 * honest option here; the number fields below use the emptier idiom instead.
 */
function SwatchRow({ label, value, onPick }: SwatchRowProps) {
  const inputId = useId()
  const mixed = isMixed(value)

  return (
    <div className="properties__field">
      <span className="properties__label" id={`${inputId}-label`}>
        {label}
        {mixed && (
          <span className="properties__mixed" data-testid="mixed-indicator">
            Mixed
          </span>
        )}
      </span>
      <div
        className="properties__swatches"
        role="group"
        aria-labelledby={`${inputId}-label`}
      >
        {PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className="properties__swatch"
            data-testid="swatch"
            data-swatch={color}
            aria-label={`${label}: ${color}`}
            aria-pressed={!mixed && value === color}
            style={{ background: color }}
            onClick={() => {
              onPick(color)
            }}
          />
        ))}
        <input
          type="color"
          className="properties__picker"
          data-testid={`picker-${label.toLowerCase().replace(/\s+/g, '-')}`}
          aria-label={`${label}, custom colour`}
          // A colour input cannot be blank, so a mixed selection falls back to
          // the palette's first entry purely as a starting point for the
          // picker — the badge above is what tells the user the truth.
          value={mixed ? PALETTE[0] : value}
          onChange={(event) => {
            onPick(event.target.value)
          }}
        />
      </div>
    </div>
  )
}

interface NumberFieldProps {
  label: string
  value: Shared<number>
  min: number
  max: number
  step: number
  onCommit: (value: number) => void
}

/**
 * A number field for a divergent selection is left *empty* with a "Mixed"
 * placeholder — the idiom the task calls for, and the one that works here
 * because unlike a colour input a number input has a blank state.
 */
function NumberField({ label, value, min, max, step, onCommit }: NumberFieldProps) {
  const inputId = useId()
  const mixed = isMixed(value)

  return (
    <div className="properties__field">
      <label className="properties__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="number"
        className="properties__number"
        data-testid={`number-${label.toLowerCase().replace(/\s+/g, '-')}`}
        min={min}
        max={max}
        step={step}
        value={mixed ? '' : value}
        placeholder={mixed ? 'Mixed' : undefined}
        onChange={(event) => {
          const next = Number(event.target.value)
          // An empty box is the mixed state, not a request to set zero.
          if (event.target.value === '' || Number.isNaN(next)) return
          onCommit(Math.min(Math.max(next, min), max))
        }}
      />
    </div>
  )
}

interface CheckFieldProps {
  label: string
  value: Shared<boolean>
  onCommit: (value: boolean) => void
}

/** A checkbox, using the platform's own third state for a mixed selection. */
function CheckField({ label, value, onCommit }: CheckFieldProps) {
  const inputId = useId()
  const ref = useRef<HTMLInputElement>(null)
  const mixed = isMixed(value)

  useEffect(() => {
    // `indeterminate` is a property with no attribute, so it can only be set
    // from an effect. It is exactly the mixed state, natively rendered.
    if (ref.current) ref.current.indeterminate = mixed
  }, [mixed])

  return (
    <div className="properties__field">
      <label className="properties__label" htmlFor={inputId}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        className="properties__check"
        data-testid={`check-${label.toLowerCase().replace(/\s+/g, '-')}`}
        checked={mixed ? false : value}
        onChange={(event) => {
          onCommit(event.target.checked)
        }}
      />
    </div>
  )
}

/**
 * The style editor for whatever is selected.
 *
 * **Sections, not a merged form.** A mixed selection of blocks and arrows gets
 * one section each rather than a common set of controls. The tempting
 * intersection — both have a "stroke" and a "stroke width" — is a false
 * friend: a block's stroke is the outline around a filled shape, an arrow's is
 * the entire element. One slider driving both would make an arrow vanish while
 * merely thinning a block's border, and any user who wanted that could get it
 * with two moves anyway.
 *
 * Rendered as an HTML overlay rather than inside the SVG: these are real form
 * controls, and re-implementing a colour input in SVG to keep the canvas pure
 * would trade the platform's accessibility for nothing.
 */
export function PropertiesPanel() {
  const selectedIds = useDiagramStore((state) => state.selectedIds)
  const selectedConnectionIds = useDiagramStore((state) => state.selectedConnectionIds)
  const blocks = useBlockList()
  const connections = useConnectionList()

  const selectedBlockSet = new Set(selectedIds)
  const blockStyles = blocks
    .filter((block) => selectedBlockSet.has(block.id))
    .map((block) => block.style)

  const selectedConnectionSet = new Set(selectedConnectionIds)
  const connectionStyles = connections
    .filter((connection) => selectedConnectionSet.has(connection.id))
    .map((connection) => connection.style)

  // Nothing selected, nothing to style — and the canvas gets its corner back.
  if (blockStyles.length === 0 && connectionStyles.length === 0) return null

  const patchBlocks = (patch: BlockStyle, field: keyof BlockStyle, label: string) => {
    styleBlocks(patch, field, label)
  }
  const patchConnections = (
    patch: ConnectionStyle,
    field: keyof ConnectionStyle,
    label: string,
  ) => {
    styleConnections(patch, field, label)
  }

  return (
    <aside
      className="properties"
      data-testid="properties-panel"
      aria-label="Element properties"
    >
      {blockStyles.length > 0 && (
        <section className="properties__section" data-testid="block-properties">
          <h2 className="properties__heading">
            {blockStyles.length === 1 ? 'Block' : `${blockStyles.length} blocks`}
          </h2>

          <SwatchRow
            label="Fill"
            value={sharedBlockField(blockStyles, 'fill')}
            onPick={(fill) => {
              patchBlocks({ fill }, 'fill', 'fill')
            }}
          />
          <SwatchRow
            label="Border"
            value={sharedBlockField(blockStyles, 'stroke')}
            onPick={(stroke) => {
              patchBlocks({ stroke }, 'stroke', 'border colour')
            }}
          />
          <SwatchRow
            label="Text"
            value={sharedBlockField(blockStyles, 'textColor')}
            onPick={(textColor) => {
              patchBlocks({ textColor }, 'textColor', 'text colour')
            }}
          />
          <NumberField
            label="Border width"
            value={sharedBlockField(blockStyles, 'strokeWidth')}
            min={0}
            max={12}
            step={0.5}
            onCommit={(strokeWidth) => {
              patchBlocks({ strokeWidth }, 'strokeWidth', 'border width')
            }}
          />
          <NumberField
            label="Text size"
            value={sharedBlockField(blockStyles, 'fontSize')}
            min={6}
            max={96}
            step={1}
            onCommit={(fontSize) => {
              patchBlocks({ fontSize }, 'fontSize', 'text size')
            }}
          />
        </section>
      )}

      {connectionStyles.length > 0 && (
        <section className="properties__section" data-testid="connection-properties">
          <h2 className="properties__heading">
            {connectionStyles.length === 1
              ? 'Connection'
              : `${connectionStyles.length} connections`}
          </h2>

          <SwatchRow
            label="Line"
            value={sharedConnectionField(connectionStyles, 'stroke')}
            onPick={(stroke) => {
              patchConnections({ stroke }, 'stroke', 'line colour')
            }}
          />
          <NumberField
            label="Line width"
            value={sharedConnectionField(connectionStyles, 'strokeWidth')}
            min={0.5}
            max={12}
            step={0.25}
            onCommit={(strokeWidth) => {
              patchConnections({ strokeWidth }, 'strokeWidth', 'line width')
            }}
          />
          <CheckField
            label="Dashed"
            value={sharedConnectionField(connectionStyles, 'dashed')}
            onCommit={(dashed) => {
              patchConnections({ dashed }, 'dashed', 'dashes')
            }}
          />
        </section>
      )}
    </aside>
  )
}

/** Exported for the tests that assert the swatch set, and for the harness. */
export { PALETTE }
