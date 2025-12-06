/** 
 PlayerEventId, CreatorPlayerId, RoomId, SubRoomId, and ClubId are all sent from the server as numbers
 however, since they can potentially be 64 bit integers we need to convert them to strings otherwise 
 JavaScript will truncate them.
 **/
export interface EventDto {
  PlayerEventId: string;
  CreatorPlayerId: string;
  ImageName: string | null;
  RoomId: string;
  SubRoomId: number | null;
  ClubId: number | null;
  Name: string;
  Description: string;
  StartTime: string;
  EndTime: string;
  AttendeeCount: number;
  State: number;
  AccessibilityLevel: number;
  IsMultiInstance: boolean;
  SupportMultiInstanceRoomChat: boolean;
  BroadcastingRoomInstanceId: number | null;
  DefaultBroadcastPermissions: number;
  CanRequestBroadcastPermissions: number;
  RecurrenceSchedule: string | null;
}
