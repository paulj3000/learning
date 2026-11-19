/** "treasure-rush-cove" becomes "Treasure rush cove". */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/[-_./]+/g, ' ').trim();
  return spaced.length === 0 ? key : spaced[0]!.toUpperCase() + spaced.slice(1);
}
