export type BurstDetector = {
  recordAndCheck(): { exceeded: boolean; count: number }
  reset(): void
}

export function createBurstDetector(options: { limit?: number } = {}): BurstDetector {
  const limit = options.limit ?? 50
  let count = 0
  let scheduled = false
  return {
    recordAndCheck() {
      count++
      if (!scheduled) {
        scheduled = true
        queueMicrotask(() => {
          count = 0
          scheduled = false
        })
      }
      return { exceeded: count > limit, count }
    },
    reset() {
      count = 0
      scheduled = false
    },
  }
}
