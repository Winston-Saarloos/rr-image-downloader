/**
 Id fields are sent from the server as numbers, but they can exceed JavaScript's
 safe integer range, so we store them as strings.
 **/
export interface ImageCommentDto {
  SavedImageCommentId: string;
  SavedImageId: string;
  PlayerId: string;
  Comment: string;
  CheerCount: number;
  CreatedAt: string;
}
