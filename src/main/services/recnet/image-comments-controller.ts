import { ImageCommentDto } from '../../models/ImageCommentDto';
import { RecNetHttpClient, RecNetRequestOptions } from './http-client';

export class ImageCommentsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchImageComments(
    imageId: string,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<ImageCommentDto[]> {
    return this.http.requestOrThrow<ImageCommentDto[]>(
      {
        url: `https://apim.rec.net/apis/api/images/v1/${encodeURIComponent(imageId)}/comments`,
        method: 'GET',
      },
      token,
      options
    );
  }
}
