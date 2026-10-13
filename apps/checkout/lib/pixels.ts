// Los scripts de terceros (Meta, TikTok, Klaviyo) se cargan diferidos para no
// competir con la hidratación del checkout. Eso abre una ventana en la que un
// cliente rápido puede disparar un evento antes de que el SDK exista.
//
// `whenAvailable` espera a que el global aparezca y recién ahí ejecuta el
// evento, de modo que diferir la carga no cueste conversiones registradas.

const POLL_MS = 300;
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Ejecuta `run(value)` en cuanto `get()` devuelva algo distinto de null/undefined.
 * Si no aparece antes del timeout, se descarta silenciosamente.
 * Devuelve una función para cancelar la espera.
 */
export function whenAvailable<T>(
  get: () => T | null | undefined,
  run: (value: T) => void,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): () => void {
  const immediate = get();
  if (immediate) {
    run(immediate);
    return () => {};
  }

  const deadline = Date.now() + timeoutMs;
  const timer = setInterval(() => {
    const value = get();
    if (value) {
      clearInterval(timer);
      run(value);
      return;
    }
    if (Date.now() > deadline) clearInterval(timer);
  }, POLL_MS);

  return () => clearInterval(timer);
}

type PixelFn = (...args: unknown[]) => void;

function getGlobal<T>(name: string): T | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as Record<string, unknown>)[name] as T) ?? null;
}

/** Meta Pixel — dispara `fbq('track', event)` cuando el pixel esté listo. */
export function trackMeta(event: string, params?: Record<string, unknown>): () => void {
  if(typeof document === "undefined" || !/(?:^|;\s*)fem_consent=all(?:;|$)/.test(document.cookie) || process.env.NEXT_PUBLIC_FEM_PREVIEW === "true") return ()=>{};
  return whenAvailable<PixelFn>(
    () => getGlobal<PixelFn>("fbq"),
    (fbq) => fbq("track", event, params)
  );
}

/** TikTok Pixel — dispara `ttq.track(event)` cuando el pixel esté listo. */
export function trackTikTok(event: string, params?: Record<string, unknown>): () => void {
  if(typeof document === "undefined" || !/(?:^|;\s*)fem_consent=all(?:;|$)/.test(document.cookie) || process.env.NEXT_PUBLIC_FEM_PREVIEW === "true") return ()=>{};
  return whenAvailable<{ track: PixelFn }>(
    () => getGlobal<{ track?: PixelFn }>("ttq")?.track ? getGlobal<{ track: PixelFn }>("ttq") : null,
    (ttq) => ttq.track(event, params)
  );
}
