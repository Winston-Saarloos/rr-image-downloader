import {
  buildCdnImageUrl,
  shouldIncludeTokenForCdnBase,
} from '../../../shared/cdnUrl';
import { ImageDto } from '../../models/ImageDto';
import { ProfileHistoryImageDto } from '../../models/ProfileHistoryImageDto';
import { GenericResponse } from '../../models/GenericResponse';
import { RecNetHttpClient, RecNetRequestOptions } from './http-client';

export class PhotosController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchPlayerPhotos(
    accountId: string,
    params: { skip: number; take: number; sort: number; after?: string },
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<ImageDto[]> {
    const { skip, take, sort, after } = params;
    let url = `https://apim.rec.net/apis/api/images/v4/player/${encodeURIComponent(accountId)}?skip=${skip}&take=${take}&sort=${sort}`;

    if (after) {
      url += `&after=${encodeURIComponent(after)}`;
    }

    return this.http.requestOrThrow<ImageDto[]>(
      { url, method: 'GET' },
      token,
      options
    );
  }

  async fetchFeedPhotos(
    accountId: string,
    params: { skip: number; take: number; since: string },
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<ImageDto[]> {
    const { skip, take, since } = params;
    const url = `https://apim.rec.net/apis/api/images/v3/feed/player/${encodeURIComponent(accountId)}?skip=${skip}&take=${take}&since=${encodeURIComponent(since)}`;

    return this.http.requestOrThrow<ImageDto[]>(
      { url, method: 'GET' },
      token,
      options
    );
  }

  async fetchRoomPhotos(
    roomId: string,
    params: { skip: number; take: number; filter: number; sort: number },
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<ImageDto[]> {
    const { skip, take, filter, sort } = params;
    const url = `https://apim.rec.net/apis/api/images/v4/room/${encodeURIComponent(roomId)}?skip=${skip}&take=${take}&filter=${filter}&sort=${sort}`;

    return this.http.requestOrThrow<ImageDto[]>(
      { url, method: 'GET' },
      token,
      options
    );
  }

  async fetchPlayerEventPhotos(
    eventId: string,
    params: { skip: number; take: number },
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<ImageDto[]> {
    const { skip, take } = params;
    const url = `https://apim.rec.net/apis/api/images/v1/playerevent/${encodeURIComponent(eventId)}?skip=${skip}&take=${take}`;

    return this.http.requestOrThrow<ImageDto[]>(
      { url, method: 'GET' },
      token,
      options
    );
  }

  // I am suspicious of this endpoint. It returns old photos from 2018 but stops at Dec 2021.
  // It should have more recent entries.
  async fetchProfilePhotoHistory(
    token: string,
    options?: RecNetRequestOptions
  ): Promise<ProfileHistoryImageDto[]> {
    return this.http.requestOrThrow<ProfileHistoryImageDto[]>(
      {
        url: 'https://api.rec.net/api/images/v3/profile/all',
        method: 'GET',
      },
      token,
      options
    );
  }

  async downloadPhoto(
    imageName: string,
    cdnBase: string,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<GenericResponse<ArrayBuffer>> {
    const url = buildCdnImageUrl(cdnBase, imageName);
    const tokenForRequest = shouldIncludeTokenForCdnBase(cdnBase)
      ? token
      : undefined;
    return this.http.request<ArrayBuffer>(
      {
        url,
        method: 'GET',
        responseType: 'arraybuffer',
      },
      tokenForRequest,
      options
    );
  }
}
