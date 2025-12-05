import { AxiosRequestConfig } from 'axios';
import { GenericResponse } from '../../models/GenericResponse';
import { axiosRequest } from '../../utils/axiosRequest';

export class RecNetHttpClient {
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
    return axiosRequest<T>(this.buildRequestConfig(config, token));
  }

  async requestOrThrow<T>(
    config: AxiosRequestConfig,
    token?: string
  ): Promise<T> {
    const response = await this.request<T>(config, token);
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
