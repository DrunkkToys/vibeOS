import test from "node:test"
import assert from "node:assert/strict"
import {
  classifySituation,
  getActions,
  recommendAction,
  getSituationTypes,
} from "../blackbox/taxonomy.js"
import { ExposureModel } from "../blackbox/exposure-model.js"

test("classifySituation — work keywords", () => {
  assert.equal(classifySituation("I'm thinking about quitting my job"), "work")
  assert.equal(classifySituation("My boss is making life difficult"), "work")
})

test("classifySituation — relationship keywords", () => {
  assert.equal(classifySituation("My partner and I are having issues"), "relationship")
  assert.equal(classifySituation("Should I break up with my girlfriend?"), "relationship")
})

test("classifySituation — financial keywords", () => {
  assert.equal(classifySituation("Should I invest in stocks?"), "financial")
  assert.equal(classifySituation("I have too much debt"), "financial")
})

test("classifySituation — health keywords", () => {
  assert.equal(classifySituation("I need to see a doctor about this pain"), "health")
  assert.equal(classifySituation("I should exercise more regularly"), "health")
})

test("classifySituation — opportunity defaults", () => {
  assert.equal(classifySituation("I have a new opportunity"), "opportunity")
  assert.equal(classifySituation("Something vague and unclear"), "opportunity")
})

test("getActions — high exposure returns high exposure actions", () => {
  const actions = getActions("work", { total: 80 })
  assert.ok(actions.length > 0)
  assert.ok(actions.includes("change") || actions.includes("negotiate") || actions.includes("lead"))
})

test("getActions — low exposure returns low exposure actions", () => {
  const actions = getActions("work", { total: 20 })
  assert.ok(actions.length > 0)
  assert.ok(actions.includes("wait") || actions.includes("observe") || actions.includes("prepare"))
})

test("getActions — unknown situation defaults to opportunity", () => {
  const actions = getActions("unknown", { total: 50 })
  assert.ok(actions.length > 0)
})

test("recommendAction — high uncertainty suggests cautious action", () => {
  const result = recommendAction({
    situation_type: "work",
    exposure: { total: 30 },
    uncertainty_total: 80,
  })
  assert.ok(result.action)
  assert.ok(result.confidence > 0 && result.confidence <= 1)
  assert.ok(result.reasoning.length > 0)
  assert.ok(result.exposure_guidance.length > 0)
})

test("recommendAction — low uncertainty suggests confident action", () => {
  const result = recommendAction({
    situation_type: "work",
    exposure: { total: 80 },
    uncertainty_total: 15,
  })
  assert.ok(result.action)
  assert.ok(result.confidence > 0.5)
})

test("getSituationTypes — returns all types", () => {
  const types = getSituationTypes()
  assert.ok(types.includes("work"))
  assert.ok(types.includes("relationship"))
  assert.ok(types.includes("opportunity"))
  assert.ok(types.includes("health"))
  assert.ok(types.includes("financial"))
})

test("ExposureModel — computeExposure maps uncertainty to exposure", () => {
  const model = new ExposureModel()
  const highExposure = model.computeExposure(20)
  const lowExposure = model.computeExposure(80)
  assert.ok(highExposure.total > lowExposure.total)
})

test("ExposureModel — exposure is clamped 0-100", () => {
  const model = new ExposureModel()
  assert.ok(model.computeExposure(-50).total >= 0)
  assert.ok(model.computeExposure(150).total <= 100)
})

test("ExposureModel — getExposureGuidance — high exposure", () => {
  const model = new ExposureModel()
  const guidance = model.getExposureGuidance({ total: 80 })
  assert.equal(guidance.level, "high")
  assert.ok(guidance.message.length > 0)
  assert.ok(guidance.suggestion.length > 0)
})

test("ExposureModel — getExposureGuidance — low exposure", () => {
  const model = new ExposureModel()
  const guidance = model.getExposureGuidance({ total: 15 })
  assert.equal(guidance.level, "low")
  assert.ok(guidance.caution !== null)
})

test("ExposureModel — getExposureGuidance — moderate levels", () => {
  const model = new ExposureModel()
  assert.equal(model.getExposureGuidance({ total: 60 }).level, "moderate_high")
  assert.equal(model.getExposureGuidance({ total: 40 }).level, "moderate_low")
})
