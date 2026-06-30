import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/** App-wide providers. React Query owns all server state for the console. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
