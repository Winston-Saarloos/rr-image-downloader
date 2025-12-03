import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { Photo } from '../../shared/types';
import { usePhotoMetadata, ExtendedPhoto } from '../hooks/usePhotoMetadata';
import { format } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from 'recharts';
import { useTheme } from '../hooks/useTheme';

interface StatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  filePath: string;
}

interface TooltipPayload {
  name: string;
  value: number | string;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
}

// Custom Tooltip component with rounded corners and dark mode support
const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  if (active && payload && payload.length) {
    return (
      <div
        className={`rounded-lg border shadow-lg p-3 ${
          isDark
            ? 'bg-gray-800 border-gray-700 text-gray-100'
            : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <p
          className={`font-semibold mb-2 ${
            isDark ? 'text-gray-100' : 'text-gray-900'
          }`}
        >
          {label}
        </p>
        {payload.map((entry: TooltipPayload, index: number) => (
          <p
            key={index}
            className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-600'}`}
            style={{ color: entry.color }}
          >
            {entry.name}: <span className="font-semibold">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  }

  return null;
};

// Custom Legend formatter to capitalize text
const capitalizeLegend = (value: string) => {
  return value
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

interface PhotoStats {
  totalUniqueRooms: number;
  totalUniqueUsers: number;
  totalCheers: number;
  largestTimeGap: {
    days: number;
    hours: number;
    minutes: number;
    photo1Date?: Date;
    photo2Date?: Date;
  } | null;
  smallestTimeGap: {
    days: number;
    hours: number;
    minutes: number;
    photo1Date?: Date;
    photo2Date?: Date;
  } | null;
  firstPhotoDate: Date | null;
  latestPhotoDate: Date | null;
  timeSpan: { days: number; hours: number; minutes: number } | null;
  photosPerYear: Array<{
    year: string;
    userPhotos: number;
    feedPhotos: number;
  }>;
  photosPerRoom: Array<{ room: string; count: number }>;
  photosPerUser: Array<{ user: string; count: number }>;
}

export const StatsDialog: React.FC<StatsDialogProps> = ({
  open,
  onOpenChange,
  accountId,
  filePath,
}) => {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [feedPhotos, setFeedPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(false);
  const [roomMap, setRoomMap] = useState<Map<string, string>>(new Map());
  const [accountMap, setAccountMap] = useState<Map<string, string>>(new Map());
  const [expandedRooms, setExpandedRooms] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState(false);

  const { getPhotoRoom, getPhotoUsers } = usePhotoMetadata(roomMap, accountMap);

  // Load room and account data
  useEffect(() => {
    if (!accountId) return;

    const loadRoomData = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.loadRoomsData(accountId);
          if (result.success && result.data) {
            const roomMapping = new Map<string, string>();
            for (const room of result.data) {
              const roomId =
                room.id ||
                room.roomId ||
                room.Id ||
                room.RoomId ||
                room.room_id;
              const roomName =
                room.name ||
                room.roomName ||
                room.Name ||
                room.RoomName ||
                room.title ||
                room.Title;
              if (roomId && roomName) {
                roomMapping.set(String(roomId), roomName);
                if (typeof roomId === 'number') {
                  roomMapping.set(String(roomId), roomName);
                }
              }
            }
            setRoomMap(roomMapping);
          }
        }
      } catch (error) {
        // Failed to load room data
      }
    };

    const loadAccountData = async () => {
      try {
        if (window.electronAPI) {
          const result = await window.electronAPI.loadAccountsData(accountId);
          if (result.success && result.data) {
            const accountMapping = new Map<string, string>();
            for (const account of result.data) {
              const accId = account.accountId || account.id || account.Id;
              const accountName =
                account.username || account.displayName || account.name;
              if (accId && accountName) {
                accountMapping.set(String(accId), accountName);
              }
            }
            setAccountMap(accountMapping);
          }
        }
      } catch (error) {
        // Failed to load account data
      }
    };

    loadRoomData();
    loadAccountData();
  }, [accountId]);

  // Load photos and feed photos
  useEffect(() => {
    if (!open || !accountId || !filePath) {
      setPhotos([]);
      setFeedPhotos([]);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      try {
        if (window.electronAPI) {
          const [photosResult, feedPhotosResult] = await Promise.all([
            window.electronAPI.loadPhotos(accountId),
            window.electronAPI.loadFeedPhotos(accountId),
          ]);

          if (photosResult.success && photosResult.data) {
            setPhotos(photosResult.data);
          }
          if (feedPhotosResult.success && feedPhotosResult.data) {
            setFeedPhotos(feedPhotosResult.data);
          }
        }
      } catch (error) {
        // Failed to load photos
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [open, accountId, filePath]);

  // Calculate statistics
  const stats = useMemo((): PhotoStats => {
    const allPhotos = [...photos, ...feedPhotos];

    if (allPhotos.length === 0) {
      return {
        totalUniqueRooms: 0,
        totalUniqueUsers: 0,
        totalCheers: 0,
        largestTimeGap: null,
        smallestTimeGap: null,
        firstPhotoDate: null,
        latestPhotoDate: null,
        timeSpan: null,
        photosPerYear: [],
        photosPerRoom: [],
        photosPerUser: [],
      };
    }

    // Get unique rooms
    const uniqueRooms = new Set<string>();
    allPhotos.forEach(photo => {
      const room = getPhotoRoom(photo);
      if (room && room !== 'No Room Data' && room !== 'null') {
        uniqueRooms.add(room);
      }
    });

    // Get unique users
    const uniqueUsers = new Set<string>();
    allPhotos.forEach(photo => {
      const users = getPhotoUsers(photo);
      users.forEach(user => {
        if (user && user !== 'Untagged') {
          uniqueUsers.add(user);
        }
      });
    });

    // Calculate total cheers
    let totalCheers = 0;
    allPhotos.forEach(photo => {
      const extended = photo as ExtendedPhoto;
      const cheers =
        extended.Cheers ||
        extended.cheers ||
        extended.CheerCount ||
        extended.cheerCount ||
        extended.CheersCount ||
        extended.cheersCount ||
        0;
      totalCheers += typeof cheers === 'number' ? cheers : 0;
    });

    // Sort photos by date for time gap calculations
    const photosWithDates = allPhotos
      .map(photo => ({
        photo,
        date: photo.CreatedAt ? new Date(photo.CreatedAt) : null,
      }))
      .filter(
        (item): item is { photo: Photo; date: Date } => item.date !== null
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate time gaps
    let largestGap: {
      days: number;
      hours: number;
      minutes: number;
      photo1Date?: Date;
      photo2Date?: Date;
    } | null = null;
    let smallestGap: {
      days: number;
      hours: number;
      minutes: number;
      photo1Date?: Date;
      photo2Date?: Date;
    } | null = null;

    for (let i = 0; i < photosWithDates.length - 1; i++) {
      const date1 = photosWithDates[i].date;
      const date2 = photosWithDates[i + 1].date;
      const diffMs = date2.getTime() - date1.getTime();
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
      );
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      const gap = {
        days,
        hours,
        minutes,
        photo1Date: date1,
        photo2Date: date2,
      };

      if (
        !largestGap ||
        diffMs >
          largestGap.days * 24 * 60 * 60 * 1000 +
            largestGap.hours * 60 * 60 * 1000 +
            largestGap.minutes * 60 * 1000
      ) {
        largestGap = gap;
      }
      if (
        !smallestGap ||
        diffMs <
          smallestGap.days * 24 * 60 * 60 * 1000 +
            smallestGap.hours * 60 * 60 * 1000 +
            smallestGap.minutes * 60 * 1000
      ) {
        smallestGap = gap;
      }
    }

    // First and latest photo dates
    const firstPhotoDate =
      photosWithDates.length > 0 ? photosWithDates[0].date : null;
    const latestPhotoDate =
      photosWithDates.length > 0
        ? photosWithDates[photosWithDates.length - 1].date
        : null;

    let timeSpan: { days: number; hours: number; minutes: number } | null =
      null;
    if (firstPhotoDate && latestPhotoDate) {
      const diffMs = latestPhotoDate.getTime() - firstPhotoDate.getTime();
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
      );
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      timeSpan = { days, hours, minutes };
    }

    // Photos per year - separate user photos and feed photos
    const userPhotosYearMap = new Map<string, number>();
    const feedPhotosYearMap = new Map<string, number>();

    photos.forEach(photo => {
      if (photo.CreatedAt) {
        const year = new Date(photo.CreatedAt).getFullYear().toString();
        userPhotosYearMap.set(year, (userPhotosYearMap.get(year) || 0) + 1);
      }
    });

    feedPhotos.forEach(photo => {
      if (photo.CreatedAt) {
        const year = new Date(photo.CreatedAt).getFullYear().toString();
        feedPhotosYearMap.set(year, (feedPhotosYearMap.get(year) || 0) + 1);
      }
    });

    // Combine all years from both maps
    const allYears = new Set([
      ...userPhotosYearMap.keys(),
      ...feedPhotosYearMap.keys(),
    ]);
    const photosPerYear = Array.from(allYears)
      .map(year => ({
        year,
        userPhotos: userPhotosYearMap.get(year) || 0,
        feedPhotos: feedPhotosYearMap.get(year) || 0,
      }))
      .sort((a, b) => a.year.localeCompare(b.year));

    // Photos per room
    const roomMap = new Map<string, number>();
    allPhotos.forEach(photo => {
      const room = getPhotoRoom(photo);
      if (room && room !== 'No Room Data' && room !== 'null') {
        roomMap.set(room, (roomMap.get(room) || 0) + 1);
      }
    });
    const photosPerRoom = Array.from(roomMap.entries())
      .map(([room, count]) => ({ room, count }))
      .sort((a, b) => b.count - a.count);

    // Photos per user
    const userMap = new Map<string, number>();
    allPhotos.forEach(photo => {
      const users = getPhotoUsers(photo);
      users.forEach(user => {
        if (user && user !== 'Untagged') {
          userMap.set(user, (userMap.get(user) || 0) + 1);
        }
      });
    });
    const photosPerUser = Array.from(userMap.entries())
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalUniqueRooms: uniqueRooms.size,
      totalUniqueUsers: uniqueUsers.size,
      totalCheers,
      largestTimeGap: largestGap,
      smallestTimeGap: smallestGap,
      firstPhotoDate,
      latestPhotoDate,
      timeSpan,
      photosPerYear,
      photosPerRoom,
      photosPerUser,
    };
  }, [photos, feedPhotos, getPhotoRoom, getPhotoUsers]);

  const formatTimeGap = (
    gap: { days: number; hours: number; minutes: number } | null
  ): string => {
    if (!gap) return 'N/A';
    const parts: string[] = [];
    if (gap.days > 0) parts.push(`${gap.days} day${gap.days !== 1 ? 's' : ''}`);
    if (gap.hours > 0)
      parts.push(`${gap.hours} hour${gap.hours !== 1 ? 's' : ''}`);
    if (gap.minutes > 0 || parts.length === 0)
      parts.push(`${gap.minutes} minute${gap.minutes !== 1 ? 's' : ''}`);
    return parts.join(', ');
  };

  const displayedRooms = expandedRooms
    ? stats.photosPerRoom.slice(0, 100)
    : stats.photosPerRoom.slice(0, 10);
  const displayedUsers = expandedUsers
    ? stats.photosPerUser.slice(0, 100)
    : stats.photosPerUser.slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Photo Statistics
          </DialogTitle>
          <DialogDescription>
            Statistics for photos and feed photos
            {accountId ? ` (Account: ${accountId})` : ''}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading statistics...
          </div>
        ) : photos.length === 0 && feedPhotos.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            No photos available to display statistics.
          </div>
        ) : (
          <div className="space-y-6 mt-4">
            {/* Summary Statistics */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Total Photos
                </div>
                <div className="text-2xl font-bold">
                  {photos.length + feedPhotos.length}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {photos.length} photos, {feedPhotos.length} feed photos
                </div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Unique Rooms
                </div>
                <div className="text-2xl font-bold">
                  {stats.totalUniqueRooms}
                </div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Unique Users Tagged
                </div>
                <div className="text-2xl font-bold">
                  {stats.totalUniqueUsers}
                </div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Total Cheers
                </div>
                <div className="text-2xl font-bold">
                  {stats.totalCheers.toLocaleString()}
                </div>
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Largest Time Gap
                </div>
                <div className="text-lg font-semibold">
                  {formatTimeGap(stats.largestTimeGap)}
                </div>
                {stats.largestTimeGap?.photo1Date &&
                  stats.largestTimeGap?.photo2Date && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {format(stats.largestTimeGap.photo1Date, 'MMM d, yyyy')} →{' '}
                      {format(stats.largestTimeGap.photo2Date, 'MMM d, yyyy')}
                    </div>
                  )}
              </div>
              <div className="p-4 border rounded-lg">
                <div className="text-sm text-muted-foreground">
                  Smallest Time Gap
                </div>
                <div className="text-lg font-semibold">
                  {formatTimeGap(stats.smallestTimeGap)}
                </div>
                {stats.smallestTimeGap?.photo1Date &&
                  stats.smallestTimeGap?.photo2Date && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {format(stats.smallestTimeGap.photo1Date, 'MMM d, yyyy')}{' '}
                      →{' '}
                      {format(stats.smallestTimeGap.photo2Date, 'MMM d, yyyy')}
                    </div>
                  )}
              </div>
            </div>

            {/* Date Range */}
            {stats.firstPhotoDate &&
              stats.latestPhotoDate &&
              stats.timeSpan && (
                <div className="p-4 border rounded-lg">
                  <div className="text-sm text-muted-foreground mb-2">
                    Photo Timeline
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-sm">First Photo:</span>
                      <span className="font-semibold">
                        {format(stats.firstPhotoDate, 'MMMM d, yyyy')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Latest Photo:</span>
                      <span className="font-semibold">
                        {format(stats.latestPhotoDate, 'MMMM d, yyyy')}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-sm">Time Span:</span>
                      <span className="font-semibold">
                        {formatTimeGap(stats.timeSpan)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

            {/* Photos per Year Chart */}
            {stats.photosPerYear.length > 0 && (
              <div className="p-4 border rounded-lg">
                <h3 className="text-lg font-semibold mb-4">Photos per Year</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={stats.photosPerYear}>
                    <CartesianGrid vertical={false} horizontal={false} />
                    <XAxis dataKey="year" />
                    <YAxis />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" formatter={capitalizeLegend} />
                    <Bar dataKey="userPhotos" fill="#f6511d" name="User Photos">
                      <LabelList
                        dataKey="userPhotos"
                        position="top"
                        formatter={(value: number) => value || ''}
                        style={{ fill: 'currentColor', fontSize: '12px' }}
                      />
                    </Bar>
                    <Bar dataKey="feedPhotos" fill="#ffb400" name="Feed Photos">
                      <LabelList
                        dataKey="feedPhotos"
                        position="top"
                        formatter={(value: number) => value || ''}
                        style={{ fill: 'currentColor', fontSize: '12px' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Photos per Room Chart */}
            {stats.photosPerRoom.length > 0 && (
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Photos per Room</h3>
                  {stats.photosPerRoom.length > 10 && (
                    <button
                      onClick={() => setExpandedRooms(!expandedRooms)}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {expandedRooms ? (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          Show Less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          Show Top 100
                        </>
                      )}
                    </button>
                  )}
                </div>
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(300, displayedRooms.length * 30)}
                >
                  <BarChart
                    data={displayedRooms}
                    layout="vertical"
                    margin={{ top: 5, right: 80, left: 100, bottom: 5 }}
                  >
                    <CartesianGrid vertical={false} horizontal={false} />
                    <XAxis type="number" />
                    <YAxis
                      dataKey="room"
                      type="category"
                      width={90}
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" formatter={capitalizeLegend} />
                    <Bar dataKey="count" fill="#00a6ed" name="Count">
                      <LabelList
                        dataKey="count"
                        position="right"
                        formatter={(value: number) => value}
                        style={{ fill: 'currentColor' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Photos per User Chart */}
            {stats.photosPerUser.length > 0 && (
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Photos per User</h3>
                  {stats.photosPerUser.length > 10 && (
                    <button
                      onClick={() => setExpandedUsers(!expandedUsers)}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      {expandedUsers ? (
                        <>
                          <ChevronUp className="h-4 w-4" />
                          Show Less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-4 w-4" />
                          Show Top 100
                        </>
                      )}
                    </button>
                  )}
                </div>
                <ResponsiveContainer
                  width="100%"
                  height={Math.max(300, displayedUsers.length * 30)}
                >
                  <BarChart
                    data={displayedUsers}
                    layout="vertical"
                    margin={{ top: 5, right: 80, left: 100, bottom: 5 }}
                  >
                    <CartesianGrid vertical={false} horizontal={false} />
                    <XAxis type="number" />
                    <YAxis
                      dataKey="user"
                      type="category"
                      width={90}
                      interval={0}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend iconType="circle" formatter={capitalizeLegend} />
                    <Bar dataKey="count" fill="#7fb800" name="Count">
                      <LabelList
                        dataKey="count"
                        position="right"
                        formatter={(value: number) => value}
                        style={{ fill: 'currentColor' }}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
