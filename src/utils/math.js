export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}
export function lerp(a, b, t) {
    return a + (b - a) * t;
}
export function roundTo(value, decimals) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
