import React, { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { AvailableRoom } from '../../shared/types';

export interface RoomSelectProps {
  availableRooms: AvailableRoom[];
  value: string | undefined;
  onValueChange: (roomId: string) => void;
  disabled?: boolean;
}

export const RoomSelect: React.FC<RoomSelectProps> = ({
  availableRooms,
  value,
  onValueChange,
  disabled = false,
}) => {
  const sortedRooms = useMemo(() => {
    return [...availableRooms].sort((a, b) =>
      (a.displayLabel || a.name || a.roomId).localeCompare(
        b.displayLabel || b.name || b.roomId,
        undefined,
        { sensitivity: 'base', numeric: true }
      )
    );
  }, [availableRooms]);

  return (
    <Select
      value={value || ''}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger className="min-w-0 w-full sm:w-[250px] [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left [&>span]:leading-normal [&>span]:line-clamp-none">
        <SelectValue placeholder="Select a room" />
      </SelectTrigger>
      <SelectContent>
        {sortedRooms.map(room => (
          <SelectItem key={room.roomId} value={room.roomId}>
            {room.displayLabel || room.name || room.roomId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
