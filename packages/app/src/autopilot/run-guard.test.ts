import { describe, expect, test } from "bun:test"
import { createBurstDetector } from "./run-guard"

describe("autopilot burst detector", () => {
  test("does not trip below the limit", () => {
    const guard = createBurstDetector({ limit: 5 })
    for (let i = 0; i < 5; i++) {
      expect(guard.recordAndCheck().exceeded).toBe(false)
    }
  })

  test("trips once the synchronous count exceeds the limit", () => {
    const guard = createBurstDetector({ limit: 5 })
    let tripped = false
    for (let i = 0; i < 200; i++) {
      const result = guard.recordAndCheck()
      if (result.exceeded) {
        tripped = true
        expect(result.count).toBeGreaterThan(5)
        break
      }
    }
    expect(tripped).toBe(true)
  })

  test("burst counter resets after the next microtask flush", async () => {
    const guard = createBurstDetector({ limit: 3 })
    for (let i = 0; i < 3; i++) {
      expect(guard.recordAndCheck().exceeded).toBe(false)
    }
    await Promise.resolve()
    for (let i = 0; i < 3; i++) {
      expect(guard.recordAndCheck().exceeded).toBe(false)
    }
  })

  test("manual reset clears the counter", () => {
    const guard = createBurstDetector({ limit: 3 })
    for (let i = 0; i < 4; i++) guard.recordAndCheck()
    guard.reset()
    expect(guard.recordAndCheck().exceeded).toBe(false)
  })

  test("simulates the original infinite-effect-loop pattern and trips quickly", () => {
    const guard = createBurstDetector({ limit: 50 })
    let setRunCalls = 0
    let tripped = false
    while (setRunCalls < 1_000) {
      setRunCalls++
      if (guard.recordAndCheck().exceeded) {
        tripped = true
        break
      }
    }
    expect(tripped).toBe(true)
    expect(setRunCalls).toBeLessThan(60)
  })
})
