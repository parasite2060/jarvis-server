export function truncateId(id: string, max: number): string {
  if (!id || id.length <= max) return id;
  return id.substring(id.length - max);
}

export function withTruncation<TArgs extends unknown[]>(generator: (...args: TArgs) => string, max: number): (...args: TArgs) => string {
  return (...args: TArgs) => truncateId(generator(...args), max);
}
