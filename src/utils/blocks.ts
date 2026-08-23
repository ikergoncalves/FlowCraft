import type { Block, BlockType, Point, Size } from '../types'

/** Size a freshly created block gets, in world units. */
export const DEFAULT_BLOCK_SIZE: Record<BlockType, Size> = {
  rect: { width: 160, height: 80 },
  text: { width: 140, height: 32 },
}

export const DEFAULT_BLOCK_TEXT: Record<BlockType, string> = {
  rect: 'Block',
  text: 'Text',
}

/**
 * Geometry for a new block centred on `center` (world space). Lives in utils
 * rather than the store so the store stays free of geometry.
 */
export function makeBlockAt(type: BlockType, center: Point): Omit<Block, 'id'> {
  const size = DEFAULT_BLOCK_SIZE[type]
  return {
    type,
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
    text: DEFAULT_BLOCK_TEXT[type],
  }
}
