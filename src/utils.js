export function db2mag(val) {
  return Math.exp(0.1151292546497023 * val);
}

export function val2pct(val, min, max) {
  if (min === max) return max;
  let value = val;

  if (val > max) value = max;
  else if (val < min) value = min;

  return (value - min) / (max - min);
}

export function toDecibel(value) {
  return 20 * Math.log10(value);
}

export function normalize(value, minValue, maxValue) {
  const val = (value - minValue) / (maxValue - minValue);
  return clamp(val, 0, 1);
}

export function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(value, maxValue));
}
