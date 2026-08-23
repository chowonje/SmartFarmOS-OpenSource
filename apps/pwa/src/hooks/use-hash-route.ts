import { useCallback, useEffect, useState } from "react";

export function parseHashRoute(hash: string, routes: readonly string[]): string {
  const normalized = hash.replace(/^#/, "").trim();
  return routes.includes(normalized) ? normalized : routes[0] ?? "overview";
}

export function useHashRoute(routes: readonly string[]): {
  readonly route: string;
  readonly setRoute: (route: string) => void;
} {
  const [route, setRouteState] = useState(() => parseHashRoute(window.location.hash, routes));

  useEffect(() => {
    const syncRoute = () => setRouteState(parseHashRoute(window.location.hash, routes));
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, [routes]);

  const setRoute = useCallback((nextRoute: string) => {
    const resolvedRoute = routes.includes(nextRoute) ? nextRoute : routes[0] ?? "overview";
    const nextHash = `#${resolvedRoute}`;
    if (window.location.hash === nextHash) {
      setRouteState(resolvedRoute);
      return;
    }
    window.location.hash = nextHash;
  }, [routes]);

  return { route, setRoute };
}
