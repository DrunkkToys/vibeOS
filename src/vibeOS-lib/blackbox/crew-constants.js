// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// Crew Constants — action narratives, fallback plans, curiosity prompts.
// Ported from theWay: src/decision/orch/crew_constants.py
export const ACTION_TARGET = {
    observe: "ACCELERATING",
    defer: "ACCELERATING",
    explore: "ACCELERATING",
    act: "STABILIZE",
    commit: "STABILIZE",
    change: "ACCELERATING",
};
export const ACTION_TYPE = {
    observe: "watch, document, wait",
    defer: "prepare, question, delay commitment",
    explore: "test, research, small experiments",
    act: "execute, commit, announce",
    commit: "finalize, protect, review",
    change: "stop, pivot, rebuild",
};
export const FALLBACK_PLANS = {
    observe: [
        "Step 1: Write down everything you know and everything you don't — clarity starts with taking inventory of what is actually known",
        "Step 2: Set a specific 7-day review date on your calendar — structured observation needs a deadline or it turns into procrastination",
        "Check Point 3: Have I identified at least 3 new facts I didn't know before? — if no, extend observation another week",
    ],
    defer: [
        "Step 1: List 5 specific questions that need answers before you can decide — turn vague anxiety into a concrete research agenda",
        "Step 2: Set a firm decision deadline (date + time) — deferral without a boundary becomes avoidance",
        "Check Point 3: Can I name the single best option if I had to choose today? — if yes, ready to move from defer to act",
    ],
    explore: [
        "Step 1: Research 3 concrete options with real numbers (prices, salaries, timelines) — abstract options are the enemy of real insight",
        "Step 2: Run one small experiment this week that costs less than your fear of being wrong — a small bet reveals more than hours of thinking",
        "Check Point 3: Do I have a clear frontrunner among the options now? — if yes shift to act; if no widen the search",
    ],
    act: [
        "Step 1: Take the first visible step in the next 48 hours — momentum creates clarity faster than analysis ever will",
        "Step 2: Tell one person your plan out loud — speaking a commitment makes it real and surfaces hidden doubts",
        "Check Point 3: Have I removed the biggest obstacle to moving forward? — if no name it and take one step to reduce it",
    ],
    commit: [
        "Step 1: Make the formal commitment (sign, say yes, transfer funds, announce) — half measures drain more energy than full commitment",
        "Step 2: Set clear boundaries around your commitment — protect what you are building by saying no to what distracts from it",
        "Check Point 3: Have I scheduled the first review in 30 days? — commitment without a feedback loop drifts off course",
    ],
    change: [
        "Step 1: Name one thing I will stop doing today — cannot pivot while holding the old rope with both hands",
        "Step 2: Take one small action in the new direction before the day ends — a single step breaks the inertia of the old path",
        "Check Point 3: Have I told one person about my new direction? — external accountability prevents sliding back",
    ],
};
export const ACTION_SUGGESTIONS = {
    observe: "Gather more information before deciding. Watch for patterns. The most powerful move right now is paying attention.",
    defer: "Hold your position. The stakes are high and the picture is unclear. Set a specific date to re-evaluate.",
    explore: "There are paths you haven't considered yet. Talk to people who see things differently. Stay curious.",
    act: "This is the time. Take one deliberate step forward — not the whole journey, just the next visible step.",
    commit: "Everything points in the same direction. Pour your full energy into this path.",
    change: "The old way has run its course. Pivoting is not failure — it is alignment with what is true now.",
};
export const CURIOSITY_PROMPTS = {
    observe: "What are you noticing that you didn't see before?",
    defer: "What would need to be true for you to move forward?",
    explore: "Which option feels most alive to you right now?",
    act: "What is the smallest next step you can take today?",
    commit: "What does full commitment look like for you?",
    change: "What are you ready to release?",
};
