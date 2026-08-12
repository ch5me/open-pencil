/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />
/// <reference types="unplugin-icons/types/vue" />

interface ImportMetaEnv {
  readonly VITE_OPENPENCIL_ENGINE_TRANSPORT?: "true" | "false" | "1" | "0";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __OPENPENCIL_APP_VERSION__: string;
declare const __OPENPENCIL_LOCAL_AUTOMATION_TOKEN__: string | null;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
