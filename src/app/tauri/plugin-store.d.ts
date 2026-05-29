// Deferred type declarations for @tauri-apps/plugin-store.
// The actual package will be installed when the desktop bearer flow is enabled.
declare module '@tauri-apps/plugin-store' {
  interface StoreInstance {
    get: <T>(key: string) => Promise<T | undefined>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
    save: () => Promise<void>
  }
  export const Store: {
    load: (filename: string) => Promise<StoreInstance>
  }
}
