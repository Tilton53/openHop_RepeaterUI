import { vi, beforeEach } from 'vitest';
import apiClient from '@/utils/api';

class StorageMock {
  private data = new Map<string, string>();

  get length() {
    return this.data.size;
  }

  clear() {
    this.data.clear();
  }

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}

vi.stubGlobal('Storage', StorageMock as unknown as typeof Storage);
Object.defineProperty(globalThis, 'localStorage', {
  value: new StorageMock(),
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: new StorageMock(),
  configurable: true,
  writable: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({
    data: {
      valid: true,
      blocked_restart: false,
      errors: [],
      warnings: [],
      message: 'Configuration preflight passed.',
    },
  } as never);
  vi.mocked(apiClient.post).mockResolvedValue({ success: true, message: 'ok' } as never);
});
