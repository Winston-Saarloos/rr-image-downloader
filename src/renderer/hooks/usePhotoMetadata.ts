import { useCallback, useMemo } from 'react';
import { Photo } from '../../shared/types';

export interface ExtendedPhoto extends Photo {
  RoomId?: number | string | null;
  roomId?: number | string | null;
  Room?: string;
  RoomName?: string;
  Users?: string[];
  TaggedUsers?: string[];
  TaggedPlayerIds?: number[];
  Description?: string;
}

export const usePhotoMetadata = (
  roomMap?: Map<string, string>,
  accountMap?: Map<string, string>
) => {
  const fallbackMap = useMemo(() => new Map<string, string>(), []);
  const safeRoomMap = roomMap ?? fallbackMap;
  const safeAccountMap = accountMap ?? fallbackMap;

  const getPhotoRoom = useCallback(
    (photo: Photo): string => {
      const extended = photo as ExtendedPhoto;

      const rawRoomId =
        extended.RoomId ??
        extended.roomId ??
        (typeof extended.Room === 'string' || typeof extended.Room === 'number'
          ? extended.Room
          : undefined);
      if (rawRoomId === null) {
        return 'null';
      }
      const roomId =
        rawRoomId !== undefined && rawRoomId !== '' ? rawRoomId : undefined;

      if (roomId !== undefined) {
        const roomIdStr = String(roomId);
        const mappedRoomName =
          safeRoomMap.get(roomIdStr) ||
          safeRoomMap.get(String(Number(roomIdStr))) ||
          (typeof extended.RoomName === 'string'
            ? extended.RoomName
            : undefined);

        if (mappedRoomName) {
          return mappedRoomName;
        }

        // While metadata is still downloading, show the ID until we can swap to the name
        return roomIdStr;
      }

      return extended.RoomName || 'No Room Data';
    },
    [safeRoomMap]
  );

  const getPhotoUsers = useCallback(
    (photo: Photo): string[] => {
      const extended = photo as ExtendedPhoto;
      const userIds =
        extended.TaggedPlayerIds ||
        extended.Users ||
        extended.TaggedUsers ||
        [];

      if (!Array.isArray(userIds)) {
        return [];
      }

      return userIds.map(userId => {
        const userName = safeAccountMap.get(String(userId));
        return userName || String(userId);
      });
    },
    [safeAccountMap]
  );

  const getPhotoImageUrl = useCallback((photo: Photo): string => {
    if (photo.localFilePath) {
      const encodedPath = encodeURIComponent(photo.localFilePath);
      return `local://${encodedPath}`;
    }

    if (photo.ImageName) {
      return `https://img.rec.net/${photo.ImageName}`;
    }

    return '';
  }, []);

  return {
    getPhotoRoom,
    getPhotoUsers,
    getPhotoImageUrl,
  };
};
