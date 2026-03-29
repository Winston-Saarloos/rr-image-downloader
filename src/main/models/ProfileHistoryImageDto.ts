export interface ProfileHistoryImageDto {
  Id: string | number;
  Type: number;
  Accessibility: number;
  AccessibilityLocked: boolean;
  ImageName: string;
  Description: string | null;
  PlayerId: string | number;
  TaggedPlayerIds: Array<string | number>;
  RoomId: string | number | null;
  PlayerEventId: string | number | null;
  CreatedAt: string;
  CheerCount: number;
  CommentCount: number;
}
