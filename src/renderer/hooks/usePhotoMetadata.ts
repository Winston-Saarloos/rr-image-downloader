import { useCallback, useMemo } from 'react';
import { Photo } from '../../shared/types';

export interface PhotoEventInfo {
  id?: string;
  name?: string;
}

const normalizeId = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return '';
    }
    return Math.trunc(value).toString();
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
};

const getMapValue = (
  map: Map<string, string>,
  key: unknown
): string | undefined => {
  if (key === null || key === undefined) {
    return undefined;
  }

  const typedMap = map as unknown as Map<unknown, string>;
  const direct = typedMap.get(key);
  if (direct) {
    return direct;
  }

  const normalizedKey = normalizeId(key);
  if (!normalizedKey) {
    return undefined;
  }

  const byString = typedMap.get(normalizedKey);
  if (byString) {
    return byString;
  }

  if (/^-?\d+$/.test(normalizedKey)) {
    const asNumber = Number(normalizedKey);
    if (Number.isSafeInteger(asNumber)) {
      return typedMap.get(asNumber);
    }
  }

  return undefined;
};

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
      const roomId = normalizeId(photo.RoomId);
      if (roomId) {
        const mappedRoomName = getMapValue(safeRoomMap, roomId);
        return mappedRoomName || roomId;
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
        const normalizedUserId = normalizeId(userId);
        const userName = getMapValue(safeAccountMap, normalizedUserId);
        return userName || normalizedUserId || String(userId);
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
      const rawEventId =
        photo.PlayerEventId || photo.EventId || photo.EventInstanceId;
      const eventId = normalizeId(rawEventId);

      if (!eventId) {
        return {};
      }

      return {
        id: eventId,
        name: getMapValue(safeEventMap, eventId),
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
