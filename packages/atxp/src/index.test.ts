import { describe, it, expect } from 'vitest'

describe('ATXP CLI', () => {
  it('should be importable', () => {
    expect(() => import('./index.js')).not.toThrow()
  })
})
