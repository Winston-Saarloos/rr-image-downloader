/** 
accountId is sent from the server as a number
 however, since they can potentially be 64 bit integers we need to convert them to strings otherwise 
 JavaScript will truncate them.
 **/
export interface PlayerResult {
  accountId: string;
  username: string;
  displayName: string;
  displayEmoji: string;
  profileImage: string;
  bannerImage: string;
  isJunior: boolean;
  platforms: number;
  personalPronouns: number;
  identityFlags: number;
  createdAt: string;
  isMetaPlatformBlocked: boolean;
}
