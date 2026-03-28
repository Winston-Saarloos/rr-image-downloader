import { AxiosRequestConfig } from 'axios';
import { GenericResponse } from '../../models/GenericResponse';
import { axiosRequest } from '../../utils/axiosRequest';

export const UNIVERSAL_BATCH_SIZE = 100_000;
export interface RecNetRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class RecNetHttpClient {
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
}
