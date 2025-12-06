/** 
 Id, PlayerId, TaggedPlayerIds, Roomid, and PlayerEventId are all sent from the server as numbers
 however, since they can potentially be 64 bit integers we need to convert them to strings otherwise 
 JavaScript will truncate them.
 **/
export interface ImageDto {
  Id: string;
  Type: number;
  Accessibility: number;
  AccessibilityLocked: boolean;
  ImageName: string;
  Description: string;
  PlayerId: string;
  TaggedPlayerIds: string[];
  RoomId: string;
  PlayerEventId: string;
  CreatedAt: string;
  CheerCount: number;
  CommentCount: number;
}
