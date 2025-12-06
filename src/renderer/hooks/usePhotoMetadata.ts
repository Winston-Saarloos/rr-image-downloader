import { useCallback, useMemo } from 'react';
import { Photo } from '../../shared/types';

export interface PhotoEventInfo {
  id?: string;
  name?: string;
}

export const usePhotoMetadata = (
  roomMap?: Map<string, string>,
  accountMap?: Map<string, string>,
  eventMap?: Map<string, string>
) => {
  const fallbackMap = useMemo(() => new Map<string, string>(), []);
  const safeRoomMap = roomMap ?? fallbackMap;
  const safeAccountMap = accountMap ?? fallbackMap;
  const safeEventMap = eventMap ?? fallbackMap;

  const getPhotoRoom = useCallback(
    (photo: Photo): string => {
      if (photo.RoomId) {
        const mappedRoomName = safeRoomMap.get(photo.RoomId);
        return mappedRoomName || photo.RoomId;
      }

      return 'No Room Data';
    },
    [safeRoomMap]
  );

  const getPhotoUsers = useCallback(
    (photo: Photo): string[] => {
      const userIds = Array.isArray(photo.TaggedPlayerIds)
        ? photo.TaggedPlayerIds
        : [];

      if (!Array.isArray(userIds)) {
        return [];
      }

      return userIds.map(userId => {
        const userName = safeAccountMap.get(String(userId));
        return userName || userId;
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

  const getPhotoEvent = useCallback(
    (photo: Photo): PhotoEventInfo => {
      const eventId =
        photo.PlayerEventId || photo.EventId || photo.EventInstanceId;

      if (!eventId) {
        return {};
      }

      return {
        id: eventId,
        name: safeEventMap.get(eventId),
      };
    },
    [safeEventMap]
  );

  return {
    getPhotoRoom,
    getPhotoUsers,
    getPhotoImageUrl,
    getPhotoEvent,
  };
};
