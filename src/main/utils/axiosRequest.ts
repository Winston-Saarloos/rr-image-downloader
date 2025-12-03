import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import JSONbig from 'json-bigint';

import { GenericResponse } from '../models/GenericResponse';

const JSONbigString = JSONbig({ storeAsString: true });

const httpClient = axios.create({
  transformResponse: [
    function (data) {
      // If data is binary (ArrayBuffer, Buffer), return it unmodified
      if (data instanceof ArrayBuffer) {
        return data;
      }
      // Check for Buffer (Node.js global, safe to check with typeof)
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
        return data;
      }

      // If data is not a string, return it as-is (could be object, null, etc.)
      if (typeof data !== 'string') {
        return data;
      }

      // Only try to parse string data as JSON
      try {
        if (data) {
          return JSONbigString.parse(data);
        } else {
          return undefined;
        }
      } catch (error) {
        console.log('Error parsing JSON response: ' + error);
        return undefined;
      }
    },
  ],
});
/* eslint-disable @typescript-eslint/no-explicit-any */
export function isAxiosError(error: any): error is AxiosError {
  return error.isAxiosError === true;
}

function isGenericResponse(obj: any): obj is GenericResponse<any> {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.success === 'boolean' &&
    'value' in obj
  );
}

export async function axiosRequest<T = unknown>(
  requestConfig: AxiosRequestConfig
): Promise<GenericResponse<T>> {
  try {
    const axiosResponse: AxiosResponse =
      await httpClient.request(requestConfig);
    const { status, statusText, data } = axiosResponse;

    const isOk = status >= 200 && status < 300;

    if (isOk) {
      if (isGenericResponse(data)) {
        return data as GenericResponse<T>;
      }

      return {
        success: true,
        value: data as T,
        status,
      };
    }

    // Normalize non 200
    return {
      success: false,
      value: null,
      status,
      error: String(status),
      message: statusText || 'Request failed',
    };
  } catch (unknownError) {
    if (axios.isAxiosError(unknownError)) {
      const axiosError = unknownError as AxiosError;
      return {
        success: false,
        value: null,
        status: axiosError.response?.status,
        error: axiosError.code ?? 'NETWORK_ERROR',
        message: axiosError.message,
      };
    }

    const fallbackMessage =
      unknownError instanceof Error ? unknownError.message : 'Unknown error';
    return {
      success: false,
      value: null,
      error: 'UNKNOWN_ERROR',
      message: fallbackMessage,
    };
  }
}
