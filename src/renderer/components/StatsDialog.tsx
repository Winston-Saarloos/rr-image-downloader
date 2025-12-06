import React, { useState, useEffect, useMemo } from 'react';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Photo, PlayerResult, RoomDto } from '../../shared/types';
import { usePhotoMetadata } from '../hooks/usePhotoMetadata';
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
import { cn } from './lib/utils';

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

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-md border bg-popover text-popover-foreground shadow-md p-3">
        <p className="font-semibold mb-2 text-foreground">{label}</p>
        {payload.map((entry: TooltipPayload, index: number) => (
          <p
            key={index}
            className="text-sm text-muted-foreground"
            style={{ color: entry.color }}
          >
            {entry.name}:{' '}
            <span className="font-semibold text-foreground">{entry.value}</span>
          </p>
        ))}
      </div>
    );
  }

  return null;
};

interface CustomCursorProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

const CustomCursor: React.FC<CustomCursorProps> = ({ x, y, width, height }) => {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="hsl(var(--muted))"
      stroke="hsl(var(--border))"
      strokeWidth={1}
      strokeOpacity={0.3}
      rx={4}
    />
  );
};

const capitalizeLegend = (value: string) => {
  return value
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const hexToRgba = (hex: string, opacity = 1): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const getThemeAwareColorWithOpacity = (
  baseColor: string,
  isDark: boolean
): string => {
  if (isDark) {
    return baseColor;
  } else {
    if (baseColor.startsWith('#')) {
      return hexToRgba(baseColor, 0.9);
    }
    return baseColor;
  }
};

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtitle,
  className,
}) => {
  return (
    <Card className={cn('p-4', className)}>
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {subtitle && (
        <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
      )}
    </Card>
  );
};

interface PhotosPerYearChartProps {
  data: Array<{
    year: string;
    userPhotos: number;
    feedPhotos: number;
  }>;
}

const PhotosPerYearChart: React.FC<PhotosPerYearChartProps> = ({ data }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const userPhotosColor = getThemeAwareColorWithOpacity('#f6511d', isDark);
  const feedPhotosColor = getThemeAwareColorWithOpacity('#ffb400', isDark);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Photos per Year</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.3}
            />
            <XAxis
              dataKey="year"
              stroke="hsl(var(--muted-foreground))"
              tick={{
                fill: 'hsl(var(--muted-foreground))',
                fontSize: 12,
              }}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              tick={{
                fill: 'hsl(var(--muted-foreground))',
                fontSize: 12,
              }}
            />
            <Tooltip content={<CustomTooltip />} cursor={<CustomCursor />} />
            <Legend
              iconType="circle"
              formatter={capitalizeLegend}
              wrapperStyle={{ color: 'hsl(var(--foreground))' }}
            />
            <Bar
              dataKey="userPhotos"
              fill={userPhotosColor}
              name="User Photos"
              radius={[4, 4, 0, 0]}
            >
              <LabelList
                dataKey="userPhotos"
                position="top"
                formatter={(value: number) => value || ''}
                style={{
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                }}
              />
            </Bar>
            <Bar
              dataKey="feedPhotos"
              fill={feedPhotosColor}
              name="Feed Photos"
              radius={[4, 4, 0, 0]}
            >
              <LabelList
                dataKey="feedPhotos"
                position="top"
                formatter={(value: number) => value || ''}
                style={{
                  fill: 'hsl(var(--muted-foreground))',
                  fontSize: 12,
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

interface ExpandableChartSectionProps {
  title: string;
  data: Array<{ [key: string]: string | number }>;
  dataKey: string;
  categoryKey: string;
  color: string;
  expanded: boolean;
  onToggle: () => void;
  showExpandButton: boolean;
}

const ExpandableChartSection: React.FC<ExpandableChartSectionProps> = ({
  title,
  data,
  dataKey,
  categoryKey,
  color,
  expanded,
  onToggle,
  showExpandButton,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const displayedData = expanded ? data.slice(0, 100) : data.slice(0, 10);
  const themeAwareColor = getThemeAwareColorWithOpacity(color, isDark);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{title}</CardTitle>
          {showExpandButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="h-8"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Show Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show Top 100
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer
          width="100%"
          height={Math.max(300, displayedData.length * 30)}
        >
          <BarChart
            data={displayedData}
            layout="vertical"
            margin={{ top: 5, right: 80, left: 100, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(var(--border))"
              opacity={0.3}
            />
            <XAxis
              type="number"
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            />
            <YAxis
              dataKey={categoryKey}
              type="category"
              width={90}
              interval={0}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} cursor={<CustomCursor />} />
            <Legend
              iconType="circle"
              formatter={capitalizeLegend}
              wrapperStyle={{ color: 'hsl(var(--foreground))' }}
            />
            <Bar
              dataKey={dataKey}
              fill={themeAwareColor}
              name="Count"
              radius={[0, 4, 4, 0]}
            >
              <LabelList
                dataKey={dataKey}
                position="right"
                formatter={(value: number) => value}
                style={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
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
            const rooms = result.data as RoomDto[];
            rooms.forEach(room => {
              if (room.RoomId) {
                roomMapping.set(room.RoomId, room.Name || room.RoomId);
              }
            });
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
            const accounts = result.data as PlayerResult[];
            accounts.forEach(account => {
              const displayName =
                account.displayName || account.username || account.accountId;
              accountMapping.set(account.accountId, displayName);
            });
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
      totalCheers +=
        typeof photo.CheerCount === 'number' ? photo.CheerCount : 0;
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
              <StatCard
                label="Total Photos"
                value={photos.length + feedPhotos.length}
                subtitle={`${photos.length} photos, ${feedPhotos.length} feed photos`}
              />
              <StatCard label="Unique Rooms" value={stats.totalUniqueRooms} />
              <StatCard
                label="Unique Users Tagged"
                value={stats.totalUniqueUsers}
              />
              <StatCard
                label="Total Cheers"
                value={stats.totalCheers.toLocaleString()}
              />
              <StatCard
                label="Largest Time Gap"
                value={formatTimeGap(stats.largestTimeGap)}
                subtitle={
                  stats.largestTimeGap?.photo1Date &&
                  stats.largestTimeGap?.photo2Date
                    ? `${format(stats.largestTimeGap.photo1Date, 'MMM d, yyyy')} → ${format(stats.largestTimeGap.photo2Date, 'MMM d, yyyy')}`
                    : undefined
                }
              />
              <StatCard
                label="Smallest Time Gap"
                value={formatTimeGap(stats.smallestTimeGap)}
                subtitle={
                  stats.smallestTimeGap?.photo1Date &&
                  stats.smallestTimeGap?.photo2Date
                    ? `${format(stats.smallestTimeGap.photo1Date, 'MMM d, yyyy')} → ${format(stats.smallestTimeGap.photo2Date, 'MMM d, yyyy')}`
                    : undefined
                }
              />
            </div>

            {/* Date Range */}
            {stats.firstPhotoDate &&
              stats.latestPhotoDate &&
              stats.timeSpan && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Photo Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          First Photo:
                        </span>
                        <span className="font-semibold text-foreground">
                          {format(stats.firstPhotoDate, 'MMMM d, yyyy')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Latest Photo:
                        </span>
                        <span className="font-semibold text-foreground">
                          {format(stats.latestPhotoDate, 'MMMM d, yyyy')}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">
                          Time Span:
                        </span>
                        <span className="font-semibold text-foreground">
                          {formatTimeGap(stats.timeSpan)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

            {/* Photos per Year Chart */}
            {stats.photosPerYear.length > 0 && (
              <PhotosPerYearChart data={stats.photosPerYear} />
            )}

            {/* Photos per Room Chart */}
            {stats.photosPerRoom.length > 0 && (
              <ExpandableChartSection
                title="Photos per Room"
                data={stats.photosPerRoom}
                dataKey="count"
                categoryKey="room"
                color="#00a6ed"
                expanded={expandedRooms}
                onToggle={() => setExpandedRooms(!expandedRooms)}
                showExpandButton={stats.photosPerRoom.length > 10}
              />
            )}

            {/* Photos per User Chart */}
            {stats.photosPerUser.length > 0 && (
              <ExpandableChartSection
                title="Photos per User"
                data={stats.photosPerUser}
                dataKey="count"
                categoryKey="user"
                color="#7fb800"
                expanded={expandedUsers}
                onToggle={() => setExpandedUsers(!expandedUsers)}
                showExpandButton={stats.photosPerUser.length > 10}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
