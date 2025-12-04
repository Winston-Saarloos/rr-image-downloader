import { useCallback, useMemo } from 'react';
import { Photo } from '../../shared/types';

export interface ExtendedPhoto extends Photo {
  RoomId?: string | null;
  roomId?: string | null;
  Room?: string;
  RoomName?: string;
  Users?: string[];
  TaggedUsers?: string[];
  TaggedPlayerIds?: string[];
  Description?: string;
  EventId?: string | number | null;
  eventId?: string | number | null;
  PlayerEventId?: string | number | null;
  playerEventId?: string | number | null;
  EventInstanceId?: string | number | null;
  eventInstanceId?: string | number | null;
  EventName?: string;
  eventName?: string;
  PlayerEventName?: string;
  Event?: {
    Id?: string | number | null;
    id?: string | number | null;
    eventId?: string | number | null;
    EventId?: string | number | null;
    Name?: string;
    name?: string;
    Title?: string;
    title?: string;
    [key: string]: any;
  };
}

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

  const getPhotoEvent = useCallback(
    (photo: Photo): PhotoEventInfo => {
      const extended = photo as ExtendedPhoto & { event?: any };
      const eventObject = (extended as any).Event || (extended as any).event;
      const playerEventObject =
        (extended as any).PlayerEvent || (extended as any).playerEvent;
      const rawEventId =
        extended.EventId ??
        extended.eventId ??
        extended.PlayerEventId ??
        extended.playerEventId ??
        extended.EventInstanceId ??
        extended.eventInstanceId ??
        (eventObject
          ? (eventObject.Id ??
            eventObject.id ??
            eventObject.eventId ??
            eventObject.EventId)
          : undefined) ??
        (playerEventObject
          ? (playerEventObject.Id ??
            playerEventObject.id ??
            playerEventObject.eventId ??
            playerEventObject.EventId)
          : undefined);

      const eventId =
        rawEventId !== undefined && rawEventId !== null && rawEventId !== ''
          ? String(rawEventId)
          : undefined;

      const mappedName = eventId ? safeEventMap.get(eventId) : undefined;
      const embeddedName = eventObject
        ? (eventObject.Name ??
          eventObject.name ??
          eventObject.Title ??
          eventObject.title)
        : playerEventObject
          ? (playerEventObject.Name ??
            playerEventObject.name ??
            playerEventObject.Title ??
            playerEventObject.title)
          : undefined;
      const nameFromFields =
        extended.EventName ??
        extended.eventName ??
        (extended as any).PlayerEventName;

      return {
        id: eventId,
        name: mappedName || embeddedName || nameFromFields,
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
