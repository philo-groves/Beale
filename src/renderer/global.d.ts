import type { BealeApi } from '@shared/types';

declare global {
  interface Window {
    beale: BealeApi;
  }
}

export {};
