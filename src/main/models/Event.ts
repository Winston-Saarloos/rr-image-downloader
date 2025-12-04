export interface Event {
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
  IsMultiInstance: boolean;
  SupportMultiInstanceRoomChat: boolean;
  BroadcastingRoomInstanceId: number | null;
  DefaultBroadcastPermissions: number;
  CanRequestBroadcastPermissions: number;
  RecurrenceSchedule: string | null;
}
