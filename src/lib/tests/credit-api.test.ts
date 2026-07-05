import { describe, it } from "node:test"
import assert from "node:assert/strict"
import * as mod from "../credit-api.js"

describe("credit-api", () => {
  describe("loadCredit", () => {
    it("returns a number", () => {
      const pct = mod.loadCredit()
      assert.equal(typeof pct, "number")
      assert.ok(pct >= 0 && pct <= 150)
    })
  })

  describe("estimateTurnsRemaining", () => {
    it("returns unlimited:false, costPerTurn:null when modelId is empty", () => {
      const r = mod.estimateTurnsRemaining(10, "")
      assert.equal(r.unlimited, false)
      assert.equal(r.costPerTurn, null)
    })

    it("returns unlimited:false, costPerTurn:null when modelId is '(unset)'", () => {
      const r = mod.estimateTurnsRemaining(10, "(unset)")
      assert.equal(r.unlimited, false)
      assert.equal(r.costPerTurn, null)
    })

    it("returns unlimited:false, costPerTurn:null when modelId is 'unknown'", () => {
      const r = mod.estimateTurnsRemaining(10, "unknown")
      assert.equal(r.unlimited, false)
      assert.equal(r.costPerTurn, null)
    })

    it("returns unlimited:false, turnsRemaining:0 when balance is 0", () => {
      const r = mod.estimateTurnsRemaining(0, "haiku")
      assert.equal(r.unlimited, false)
      assert.equal(r.turnsRemaining, 0)
    })

    it("returns unlimited:false, turnsRemaining:0 when balance is negative", () => {
      const r = mod.estimateTurnsRemaining(-5, "haiku")
      assert.equal(r.unlimited, false)
      assert.equal(r.turnsRemaining, 0)
    })

    it("returns many turns for very low-cost models", () => {
      const r = mod.estimateTurnsRemaining(10, "deepseek/deepseek-chat")
      assert.equal(r.unlimited, false)
      assert.ok(r.costPerTurn !== null && r.costPerTurn! > 0)
      assert.ok(r.turnsRemaining !== null && r.turnsRemaining! > 1_000)
    })

    it("returns computed turnsRemaining for valid balance and modelId", () => {
      const r = mod.estimateTurnsRemaining(10, "haiku")
      assert.equal(r.unlimited, false)
      assert.equal(typeof r.costPerTurn, "number")
      assert.ok(r.costPerTurn > 0)
      assert.equal(typeof r.turnsRemaining, "number")
      assert.ok(r.turnsRemaining > 0)
    })

    it("works with string balance input", () => {
      const r = mod.estimateTurnsRemaining("10" as unknown as number, "haiku")
      assert.equal(r.unlimited, false)
      assert.equal(r.balanceUsd, 10)
      assert.equal(typeof r.turnsRemaining, "number")
      assert.ok(r.turnsRemaining > 0)
    })
  })

  describe("thinkingLevel", () => {
    it('returns "full" for credit >= 70', () => {
      assert.equal(mod.thinkingLevel(70), "full")
      assert.equal(mod.thinkingLevel(100), "full")
      assert.equal(mod.thinkingLevel(150), "full")
    })

    it('returns "brief" for credit < 70', () => {
      assert.equal(mod.thinkingLevel(69), "brief")
      assert.equal(mod.thinkingLevel(50), "brief")
      assert.equal(mod.thinkingLevel(0), "brief")
    })

    it('returns "brief" for credit between 40 and 69', () => {
      assert.equal(mod.thinkingLevel(40), "brief")
      assert.equal(mod.thinkingLevel(55), "brief")
      assert.equal(mod.thinkingLevel(69), "brief")
    })

    it('returns "brief" for edge values', () => {
      assert.equal(mod.thinkingLevel(69), "brief")
      assert.equal(mod.thinkingLevel(39), "brief")
      assert.equal(mod.thinkingLevel(0), "brief")
      assert.equal(mod.thinkingLevel(-1), "brief")
    })
  })

  describe("closeMcpServer", () => {
    it("returns a promise that resolves", async () => {
      const result = mod.closeMcpServer()
      assert.ok(result instanceof Promise)
      await assert.doesNotReject(result)
    })

    it("can be called multiple times", async () => {
      await assert.doesNotReject(mod.closeMcpServer())
      await assert.doesNotReject(mod.closeMcpServer())
      await assert.doesNotReject(mod.closeMcpServer())
    })
  })
})
