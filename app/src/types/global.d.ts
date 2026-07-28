import type { ExposedApi } from '../../electron/ipc-types';

declare global {
  interface Window {
    codemgr: ExposedApi;
  }
}
