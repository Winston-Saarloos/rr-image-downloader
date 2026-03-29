import React, { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { AvailableAccount } from '../../shared/types';

export interface AccountSelectProps {
  availableAccounts: AvailableAccount[];
  value: string | undefined;
  accountMap: Map<string, string>;
  /** Used to sort by Rec Room username when folder metadata does not include it in displayLabel. */
  usernameMap: Map<string, string>;
  onValueChange: (accountId: string) => void;
  disabled?: boolean;
}

function getAccountDisplayName(
  account: AvailableAccount,
  accountMap: Map<string, string>
): string {
  return (
    account.displayLabel ||
    accountMap.get(account.accountId) ||
    account.accountId
  );
}

/** Sort key: username when known (map or `Display (@username)` / `@username`), else accountId. */
function usernameSortKey(
  account: AvailableAccount,
  usernameMap: Map<string, string>
): string {
  const fromMap = usernameMap.get(account.accountId)?.trim();
  if (fromMap) return fromMap.toLowerCase();

  const label = account.displayLabel?.trim();
  if (label) {
    const paren = label.match(/\(@([^)]+)\)\s*$/);
    if (paren) return paren[1].toLowerCase();
    if (label.startsWith('@') && !/\s/.test(label)) {
      return label.slice(1).toLowerCase();
    }
  }

  return (account.accountId || '').toLowerCase();
}

export const AccountSelect: React.FC<AccountSelectProps> = ({
  availableAccounts,
  value,
  accountMap,
  usernameMap,
  onValueChange,
  disabled = false,
}) => {
  const sortedAvailableAccounts = useMemo(() => {
    return [...availableAccounts].sort((a, b) =>
      usernameSortKey(a, usernameMap).localeCompare(
        usernameSortKey(b, usernameMap),
        undefined,
        { sensitivity: 'base', numeric: true }
      )
    );
  }, [availableAccounts, usernameMap]);

  return (
    <Select
      value={value || ''}
      onValueChange={onValueChange}
      disabled={disabled}
    >
      <SelectTrigger className="min-w-0 w-full sm:w-[250px] [&>span]:min-w-0 [&>span]:flex-1 [&>span]:truncate [&>span]:text-left [&>span]:leading-normal [&>span]:line-clamp-none">
        <SelectValue placeholder="Select an account" />
      </SelectTrigger>
      <SelectContent>
        {sortedAvailableAccounts.map(account => (
          <SelectItem key={account.accountId} value={account.accountId}>
            {getAccountDisplayName(account, accountMap)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
