export function isoNow(date = new Date()): string {
  return date.toISOString();
}

export function newMemoryId(): string {
  return crypto.randomUUID();
}
