import { AxiosRequestConfig } from 'axios';
import { GenericResponse } from '../../models/GenericResponse';
import { axiosRequest } from '../../utils/axiosRequest';

// Metadata bulk endpoints are more reliable with smaller payloads. Large
// requests make partial failures harder to diagnose and can silently leave
// account/room/event caches incomplete on very large libraries. (originally was 100,000)
export const UNIVERSAL_BATCH_SIZE = 2_500;
export interface RecNetRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class RecNetHttpClient {
  private requestDelayMs = 0;
  private lastRequestStartedAt = 0;
  private throttleQueue: Promise<void> = Promise.resolve();

  setRequestDelayMs(delayMs: number): void {
    if (!Number.isFinite(delayMs)) {
      this.requestDelayMs = 0;
      return;
    }

    this.requestDelayMs = Math.max(0, Math.floor(delayMs));
  }

  private buildRequestConfig(
    config: AxiosRequestConfig,
    token?: string,
    options?: RecNetRequestOptions
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'User-Agent': 'RecNetPhotoDownloader/1.0',
      ...((config.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return {
      ...config,
      timeout: options?.timeoutMs ?? config.timeout ?? 30000,
      signal: options?.signal ?? config.signal,
      headers,
    };
  }

  async request<T>(
    config: AxiosRequestConfig,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<GenericResponse<T>> {
    await this.waitForRequestSlot(config, options?.signal);
    return axiosRequest<T>(this.buildRequestConfig(config, token, options));
  }

  async requestOrThrow<T>(
    config: AxiosRequestConfig,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<T> {
    const response = await this.request<T>(config, token, options);
    if (
      options?.signal?.aborted ||
      response.error === 'ERR_CANCELED' ||
      response.message === 'Operation cancelled'
    ) {
      throw new Error('Operation cancelled');
    }
    if (
      !response.success ||
      response.value === null ||
      response.value === undefined
    ) {
      const statusText = response.status
        ? `HTTP ${response.status}`
        : 'Request failed';
      const message = response.message || response.error || 'Request failed';
      throw new Error(`${statusText}: ${message}`);
    }

    return response.value;
  }

  private async waitForRequestSlot(
    config: AxiosRequestConfig,
    signal?: AbortSignal
  ): Promise<void> {
    let releaseQueue: (() => void) | undefined;
    const previousQueue = this.throttleQueue;
    this.throttleQueue = new Promise<void>(resolve => {
      releaseQueue = resolve;
    });

    try {
      await previousQueue;

      if (signal?.aborted) {
        throw new Error('Operation cancelled');
      }

      const requestLabel = this.describeRequest(config);
      const delayMs = this.requestDelayMs;
      const previousRequestStartedAt = this.lastRequestStartedAt;
      if (delayMs > 0 && previousRequestStartedAt > 0) {
        const elapsedMs = Date.now() - previousRequestStartedAt;
        const waitMs = Math.max(0, delayMs - elapsedMs);
        if (waitMs > 0) {
          console.log(
            `[RecNetHttpClient] request-wait ${requestLabel} waitMs=${waitMs} configuredDelayMs=${delayMs} elapsedSincePreviousStartMs=${elapsedMs}`
          );
          await this.delay(waitMs, signal);
        }
      }

      const startedAt = Date.now();
      const sincePreviousStartMs =
        previousRequestStartedAt > 0 ? startedAt - previousRequestStartedAt : -1;
      this.lastRequestStartedAt = startedAt;
      console.log(
        `[RecNetHttpClient] request-start ${requestLabel} configuredDelayMs=${delayMs} sincePreviousStartMs=${
          sincePreviousStartMs >= 0 ? sincePreviousStartMs : 'first'
        }`
      );
    } finally {
      releaseQueue?.();
    }
  }

  private describeRequest(config: AxiosRequestConfig): string {
    const method = (config.method || 'GET').toUpperCase();
    const url = config.url || '(unknown-url)';
    return `${method} ${url}`;
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) {
      return Promise.resolve();
    }

    if (signal?.aborted) {
      return Promise.reject(new Error('Operation cancelled'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        reject(new Error('Operation cancelled'));
      };

      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
