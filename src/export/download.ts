/**
 * Handing a file to the user.
 *
 * The whole DOM-touching part of exporting, deliberately kept to a dozen lines
 * in a file of its own: everything above it — the markup, the framing, the
 * rasterising — is pure enough to test, and this is the piece that only works
 * in a browser. Isolating it means the untestable surface is small enough to
 * read in one go.
 *
 * An anchor with `download` rather than `showSaveFilePicker`: the picker is
 * still not in every browser, needs a user-gesture chain this would have to
 * thread through, and its fallback is this anyway.
 */

/** Two digits, so a timestamp sorts as text. */
const pad = (value: number): string => String(value).padStart(2, '0')

/**
 * `flowcraft-2026-08-26-1432.svg`.
 *
 * Timestamped because exporting twice is normal and a browser that appends
 * `(1)` to a repeated name is doing worse bookkeeping than we can do here.
 * Local time rather than UTC: the name is for the person looking at their own
 * downloads folder.
 */
export function diagramFilename(extension: string, at: Date = new Date()): string {
  const stamp = [
    at.getFullYear(),
    pad(at.getMonth() + 1),
    pad(at.getDate()),
    `${pad(at.getHours())}${pad(at.getMinutes())}`,
  ].join('-')
  return `flowcraft-${stamp}.${extension}`
}

/** Saves a blob under `filename`, revoking the URL once the click is through. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  // Appended before clicking: Firefox ignores a click on an anchor that is not
  // in the document.
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Deferred, because revoking synchronously can cancel the download that the
  // click has only just started.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/** `downloadBlob` for text, which is what the SVG export produces. */
export function downloadText(text: string, filename: string, type: string): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename)
}
