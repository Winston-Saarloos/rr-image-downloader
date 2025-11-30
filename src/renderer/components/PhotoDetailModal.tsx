import React from 'react';
import { MapPin, Users, Calendar } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Photo } from '../../shared/types';
import { format } from 'date-fns';

interface PhotoDetailModalProps {
  photo: Photo | null;
  open: boolean;
  onClose: () => void;
  roomMap?: Map<string, string>;
  accountMap?: Map<string, string>;
}

export const PhotoDetailModal: React.FC<PhotoDetailModalProps> = ({
  photo,
  open,
  onClose,
  roomMap = new Map(),
  accountMap = new Map(),
}) => {
  if (!photo) return null;

  interface ExtendedPhoto extends Photo {
    RoomId?: number | string | null;
    roomId?: number | string | null;
    Room?: string;
    RoomName?: string;
    Users?: string[];
    TaggedUsers?: string[];
    TaggedPlayerIds?: number[];
    Description?: string;
  }

  const getPhotoRoom = (photo: Photo): string => {
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
      rawRoomId !== undefined && rawRoomId !== ''
        ? rawRoomId
        : undefined;
    
    if (roomId !== undefined) {
      const roomIdStr = String(roomId);
      let roomName = roomMap.get(roomIdStr);
      if (roomName) {
        return roomName;
      }
      // Also try with number conversion in case ID is stored as number in mapping
      const roomIdNum = Number(roomId);
      if (!isNaN(roomIdNum)) {
        roomName = roomMap.get(String(roomIdNum));
        if (roomName) {
          return roomName;
        }
      }
      if (typeof extended.RoomName === 'string') {
        return extended.RoomName;
      }
      // If no mapping found, return the ID (so user can see it exists)
      return roomIdStr;
    }
    
    // RoomId is null or doesn't exist
    return extended.RoomName || 'Unknown Room';
  };

  const getPhotoUsers = (photo: Photo): string[] => {
    const extended = photo as ExtendedPhoto;
    // TaggedPlayerIds is the field name in the photo metadata
    const userIds = extended.TaggedPlayerIds || extended.Users || extended.TaggedUsers || [];
    
    if (!Array.isArray(userIds)) {
      return [];
    }
    
    // Map user IDs to names if available
    return userIds.map((userId) => {
      const userName = accountMap.get(String(userId));
      return userName || String(userId);
    });
  };

  const getPhotoImageUrl = (photo: Photo): string => {
    // Prioritize local file over CDN for offline viewing
    if (photo.localFilePath) {
      // Use custom local:// protocol for serving files securely in Electron
      // Encode the path to handle special characters
      const encodedPath = encodeURIComponent(photo.localFilePath);
      return `local://${encodedPath}`;
    }
    // Fallback to CDN if no local file (shouldn't happen after our filtering)
    if (photo.ImageName) {
      return `https://img.rec.net/${photo.ImageName}`;
    }
    return '';
  };

  const extended = photo as ExtendedPhoto;
  const room = getPhotoRoom(photo);
  const users = getPhotoUsers(photo);
  const description = extended.Description || '';
  const imageUrl = getPhotoImageUrl(photo);
  const createdAt = photo.CreatedAt ? new Date(photo.CreatedAt) : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Photo Details</DialogTitle>
          <DialogDescription>View full resolution and details</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {imageUrl && (
            <div className="relative w-full">
              <img
                src={imageUrl}
                alt={`Photo ${photo.Id}`}
                className="w-full h-auto rounded-lg"
              />
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">Room:</span>
              <span>{room}</span>
            </div>

            {users.length > 0 && (
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <span className="font-medium">Tagged Users: </span>
                  <span>{users.join(', ')}</span>
                </div>
              </div>
            )}

            {createdAt && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Date Taken: </span>
                <span>{format(createdAt, 'MMMM d, yyyy h:mm a')}</span>
              </div>
            )}

            {description && (
              <div className="pt-2 border-t">
                <p className="font-medium mb-2">Description:</p>
                <p className="text-muted-foreground">{description}</p>
              </div>
            )}

            <div className="pt-2 border-t text-sm text-muted-foreground">
              <p>Photo ID: {photo.Id}</p>
              {photo.ImageName && <p>Image: {photo.ImageName}</p>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

