/** 
 RoomId is sent from the server as a number
 however, since they can potentially be 64 bit integers we need to convert them to strings otherwise 
 JavaScript will truncate them.
 **/
export interface RoomDto {
  RoomId: string;
  Name: string;
  Description: string;
  ImageName: string;
  WarningMask: number;
  CustomWarning: null;
  CreatorAccountId: string;
  State: number;
  Accessibility: number;
  PublishState: number;
  SupportsLevelVoting: false;
  IsRRO: boolean;
  IsRecRoomApproved: boolean;
  ExcludeFromLists: boolean;
  ExcludeFromSearch: boolean;
  SupportsScreens: boolean;
  SupportsWalkVR: boolean;
  SupportsTeleportVR: boolean;
  SupportsVRLow: boolean;
  SupportsQuest2: boolean;
  SupportsMobile: boolean;
  SupportsJuniors: boolean;
  MinLevel: number;
  AgeRating: number;
  CreatedAt: string;
  PublishedAt: string;
  BecameRRStudioRoomAt: string;
  Stats: {
    CheerCount: number;
    FavoriteCount: number;
    VisitorCount: number;
    VisitCount: number;
  };
  RankingContext: null;
  IsDorm: boolean;
  IsPlacePlay: boolean;
  MaxPlayersCalculationMode: number;
  MaxPlayers: number;
  CloningAllowed: boolean;
  DisableMicAutoMute: boolean;
  DisableRoomComments: boolean;
  EncryptVoiceChat: boolean;
  ToxmodEnabled: boolean;
  LoadScreenLocked: boolean;
  UgcVersion: number;
  PersistenceVersion: number;
  UgcSubVersion: number;
  MinUgcSubVersion: number;
  AutoLocalizedRoom: boolean;
  IsDeveloperOwned: boolean;
  RankedEntityId: string;
  BoostCount: number;
}
