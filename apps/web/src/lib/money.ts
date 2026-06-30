/** Format a USD amount: 4 decimals under $1 (sub-cent agent costs), 2 above. */
export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}
