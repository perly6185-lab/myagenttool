export type FocusQueryTarget = {
  id: string;
  nextLocation: string;
};

export function focusQueryTarget(href: string, parameter: string): FocusQueryTarget | null {
  const url = new URL(href);
  const id = url.searchParams.get(parameter);
  if (!id) return null;
  url.searchParams.delete(parameter);
  return {
    id,
    nextLocation: `${url.pathname}${url.search}${url.hash}`,
  };
}
