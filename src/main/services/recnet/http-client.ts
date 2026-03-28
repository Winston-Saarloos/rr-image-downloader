import { AxiosRequestConfig } from 'axios';
import { GenericResponse } from '../../models/GenericResponse';
import { axiosRequest } from '../../utils/axiosRequest';

export const UNIVERSAL_BATCH_SIZE = 100_000;

export class RecNetHttpClient {
  private activeAbortControllers = new Set<AbortController>();

  private buildRequestConfig(
    config: AxiosRequestConfig,
    token?: string
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'User-Agent': 'RecNetPhotoDownloader/1.0',
      ...((config.headers as Record<string, string>) || {}),
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    return {
      timeout: 30000,
      ...config,
      headers,
    };
  }

  async request<T>(
    config: AxiosRequestConfig,
    token?: string
  ): Promise<GenericResponse<T>> {
    const controller = new AbortController();
    this.activeAbortControllers.add(controller);

    try {
      return await axiosRequest<T>(
        this.buildRequestConfig(
          {
            ...config,
            signal: controller.signal,
          },
          token
        )
      );
    } finally {
      this.activeAbortControllers.delete(controller);
    }
  }

  async requestOrThrow<T>(
    config: AxiosRequestConfig,
    token?: string
  ): Promise<T> {
    const response = await this.request<T>(config, token);
    if (
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

  cancelActiveRequests(): void {
    for (const controller of this.activeAbortControllers) {
      controller.abort();
    }
    this.activeAbortControllers.clear();
  }
}
