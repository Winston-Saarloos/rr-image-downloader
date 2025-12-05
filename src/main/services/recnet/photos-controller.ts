import { Photo } from '../../../shared/types';
import { GenericResponse } from '../../models/GenericResponse';
import { RecNetHttpClient } from './http-client';

export class PhotosController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchPlayerPhotos(
    accountId: string,
    params: { skip: number; take: number; sort: number; after?: string },
    token?: string
  ): Promise<Photo[]> {
    const { skip, take, sort, after } = params;
    let url = `https://apim.rec.net/apis/api/images/v4/player/${encodeURIComponent(accountId)}?skip=${skip}&take=${take}&sort=${sort}`;

    if (after) {
      url += `&after=${encodeURIComponent(after)}`;
    }

    return this.http.requestOrThrow<Photo[]>({ url, method: 'GET' }, token);
  }

  async fetchFeedPhotos(
    accountId: string,
    params: { skip: number; take: number; since: string },
    token?: string
  ): Promise<Photo[]> {
    const { skip, take, since } = params;
    const url = `https://apim.rec.net/apis/api/images/v3/feed/player/${encodeURIComponent(accountId)}?skip=${skip}&take=${take}&since=${encodeURIComponent(since)}`;

    return this.http.requestOrThrow<Photo[]>({ url, method: 'GET' }, token);
  }

  async downloadPhoto(
    imageName: string,
    cdnBase: string,
    token?: string
  ): Promise<GenericResponse<ArrayBuffer>> {
    const normalizedBase = cdnBase.endsWith('/')
      ? cdnBase
      : `${cdnBase}/`;
    return this.http.request<ArrayBuffer>(
      {
        url: `${normalizedBase}${imageName}`,
        method: 'GET',
        responseType: 'arraybuffer',
      },
      token
    );
  }
}
