import React, { useState, useEffect, useCallback } from 'react';
import { Search, Filter, User } from 'lucide-react';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Photo, AvailableAccount } from '../../shared/types';
import { PhotoGrid } from './PhotoGrid';
import { PhotoDetailModal } from './PhotoDetailModal';

interface PhotoViewerProps {
  filePath: string;
  accountId?: string;
  isDownloading?: boolean;
  onAccountChange?: (accountId: string | undefined) => void;
}

export const PhotoViewer: React.FC<PhotoViewerProps> = ({
  filePath,
  accountId: propAccountId,
  isDownloading = false,
  onAccountChange,
}) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'none' | 'room' | 'user' | 'date'>('none');
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [availableAccounts, setAvailableAccounts] = useState<AvailableAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(propAccountId);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [roomMap, setRoomMap] = useState<Map<string, string>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());

  // Use propAccountId if provided, otherwise use selectedAccountId
  const accountId = propAccountId || selectedAccountId;

  const loadAvailableAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.listAvailableAccounts();
        if (result.success && result.data) {
          setAvailableAccounts(result.data);
          // If no account is selected and accounts are available, select the first one
          if (!selectedAccountId && !propAccountId && result.data.length > 0) {
            const firstAccountId = result.data[0].accountId;
            setSelectedAccountId(firstAccountId);
            if (onAccountChange) {
              onAccountChange(firstAccountId);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to load available accounts:', error);
    } finally {
      setLoadingAccounts(false);
    }
  }, [selectedAccountId, propAccountId, onAccountChange]);

  const loadRoomData = useCallback(async () => {
    if (!accountId) {
      setRoomMap(new Map());
      return;
    }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadRoomsData(accountId);
        if (result.success && result.data) {
          const roomMapping = new Map<string, string>();
          // Room data structure may vary, try common field names
          for (const room of result.data) {
            // Try multiple possible field names for room ID
            const roomId = room.id || room.roomId || room.Id || room.RoomId || room.room_id;
            // Try multiple possible field names for room name
            const roomName = room.name || room.roomName || room.Name || room.RoomName || room.title || room.Title;
            if (roomId && roomName) {
              roomMapping.set(String(roomId), roomName);
              // Also try with different string formats
              if (typeof roomId === 'number') {
                roomMapping.set(String(roomId), roomName);
              }
            }
          }
          console.log(`Loaded ${roomMapping.size} rooms into mapping`, Array.from(roomMapping.entries()).slice(0, 5));
          setRoomMap(roomMapping);
        } else {
          console.log('No room data found or failed to load');
          setRoomMap(new Map());
        }
      }
    } catch (error) {
      console.error('Failed to load room data:', error);
      setRoomMap(new Map());
    }
  }, [accountId]);

  const loadAccountData = useCallback(async () => {
    if (!accountId) {
      setAccountMap(new Map());
      return;
    }

    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadAccountsData(accountId);
        if (result.success && result.data) {
          const accountMapping = new Map<string, string>();
          // Account data structure may vary, try common field names
          for (const account of result.data) {
            const accountId = account.accountId || account.id || account.Id;
            const accountName = account.username || account.displayName || account.name;
            if (accountId && accountName) {
              accountMapping.set(String(accountId), accountName);
            }
          }
          setAccountMap(accountMapping);
        }
      }
    } catch (error) {
      console.error('Failed to load account data:', error);
      setAccountMap(new Map());
    }
  }, [accountId]);

  const loadPhotos = useCallback(async () => {
    if (!filePath || !accountId) {
      setPhotos([]);
      return;
    }

    setLoading(true);
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.loadPhotos(accountId);
        if (result.success && result.data) {
          setPhotos(result.data);
        } else {
          setPhotos([]);
        }
      } else {
        setPhotos([]);
      }
    } catch (error) {
      // Failed to load photos
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [filePath, accountId]);

  // Load available accounts on mount and when filePath changes
  useEffect(() => {
    if (filePath) {
      loadAvailableAccounts();
    }
  }, [filePath, loadAvailableAccounts]);

  // Update selectedAccountId when propAccountId changes
  useEffect(() => {
    if (propAccountId !== undefined) {
      setSelectedAccountId(propAccountId);
    }
  }, [propAccountId]);

  useEffect(() => {
    if (filePath && accountId) {
      loadPhotos();
      loadRoomData();
      loadAccountData();
    } else {
      setPhotos([]);
      setRoomMap(new Map());
      setAccountMap(new Map());
    }
  }, [filePath, accountId, loadPhotos, loadRoomData, loadAccountData]);

  // Reload photos, room data, and account data periodically during download
  useEffect(() => {
    if (!isDownloading || !accountId || !filePath) {
      return;
    }

    // Reload data every 2 seconds during download
    const interval = setInterval(() => {
      loadPhotos();
      loadRoomData();
      loadAccountData();
    }, 2000);

    return () => {
      clearInterval(interval);
    };
  }, [isDownloading, accountId, filePath, loadPhotos, loadRoomData, loadAccountData]);

  const handlePhotoClick = (photo: Photo) => {
    setSelectedPhoto(photo);
    setIsModalOpen(true);
  };

  const handleAccountChange = (newAccountId: string) => {
    setSelectedAccountId(newAccountId);
    if (onAccountChange) {
      onAccountChange(newAccountId);
    }
  };

  const getAccountDisplayName = (account: AvailableAccount): string => {
    const parts: string[] = [];
    if (account.hasPhotos) {
      parts.push(`${account.photoCount} photos`);
    }
    if (account.hasFeed) {
      parts.push(`${account.feedCount} feed`);
    }
    return `${account.accountId} (${parts.join(', ')})`;
  };

  return (
    <div className="space-y-4">
      {/* Account Selector */}
      {availableAccounts.length > 0 && (
        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <Select
            value={accountId || ''}
            onValueChange={handleAccountChange}
            disabled={!!propAccountId}
          >
            <SelectTrigger className="w-full sm:w-[250px]">
              <SelectValue placeholder="Select an account" />
            </SelectTrigger>
            <SelectContent>
              {availableAccounts.map((account) => (
                <SelectItem key={account.accountId} value={account.accountId}>
                  {getAccountDisplayName(account)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {propAccountId && (
            <span className="text-sm text-muted-foreground">
              (Downloading...)
            </span>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search photos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={groupBy} onValueChange={(value: 'none' | 'room' | 'user' | 'date') => setGroupBy(value)}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No Grouping</SelectItem>
            <SelectItem value="room">Group by Room</SelectItem>
            <SelectItem value="user">Group by User</SelectItem>
            <SelectItem value="date">Group by Date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loadingAccounts ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Loading accounts...</p>
        </div>
      ) : !accountId && availableAccounts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No accounts with metadata found. Download photos to get started.</p>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Loading photos...</p>
        </div>
      ) : photos.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No photos available for this account.</p>
        </div>
      ) : (
        <PhotoGrid
          photos={photos}
          onPhotoClick={handlePhotoClick}
          groupBy={groupBy}
          searchQuery={searchQuery}
          roomMap={roomMap}
          accountMap={accountMap}
        />
      )}

      <PhotoDetailModal
        photo={selectedPhoto}
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        roomMap={roomMap}
        accountMap={accountMap}
      />
    </div>
  );
};

