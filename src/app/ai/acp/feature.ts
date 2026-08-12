export function useEngineTransport(
  value: string | undefined = import.meta.env.VITE_OPENPENCIL_ENGINE_TRANSPORT
): boolean {
  return value === 'true' || value === '1'
}
