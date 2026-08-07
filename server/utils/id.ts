let seq = 0;

export function nextId(prefix: string): string {
  seq += 1;
  const time = Date.now().toString(36);
  const s = seq.toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${time}-${s}-${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}
