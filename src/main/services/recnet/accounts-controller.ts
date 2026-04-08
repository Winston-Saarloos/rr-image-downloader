import { AccountInfo } from '../../../shared/types';
import { PlayerResult } from '../../models/PlayerDto';
import {
  RecNetHttpClient,
  RecNetRequestOptions,
  UNIVERSAL_BATCH_SIZE,
} from './http-client';

export class AccountsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchBulkAccounts(
    accountIds: string[],
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<PlayerResult[]> {
    if (accountIds.length === 0) {
      return [];
    }

    const results: PlayerResult[] = [];
    const batchSize = UNIVERSAL_BATCH_SIZE;

    for (let i = 0; i < accountIds.length; i += batchSize) {
      const batch = accountIds.slice(i, i + batchSize);

      try {
        const formData = new URLSearchParams();
        for (const id of batch) {
          formData.append('id', id);
        }

        const response = await this.http.request<PlayerResult[]>(
          {
            url: 'https://accounts.rec.net/account/bulk',
            method: 'POST',
            data: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
          token,
          options
        );

        if (response.success && Array.isArray(response.value)) {
          console.log(`Accounts pulled: ${response.value.length}`)
          results.push(...this.normalizeAccounts(response.value));
        } else {
          console.log(
            `Failed to fetch batch of accounts: status ${response.status} - ${response.message || response.error}`
          );
        }
      } catch (error) {
        console.log(
          `Failed to fetch batch of accounts: ${(error as Error).message}`
        );
      }
    }

    return results;
  }

  async lookupAccountById(
    accountId: string,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<AccountInfo> {
    const account = await this.http.requestOrThrow<PlayerResult>(
      {
        url: `https://accounts.rec.net/account/${encodeURIComponent(accountId)}`,
        method: 'GET',
      },
      token,
      options
    );
    return this.normalizeAccount(account);
  }

  async lookupAccountByUsername(
    username: string,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<AccountInfo> {
    const account = await this.http.requestOrThrow<PlayerResult>(
      {
        url: `https://apim.rec.net/accounts/account/?username=${encodeURIComponent(username)}`,
        method: 'GET',
      },
      token,
      options
    );
    return this.normalizeAccount(account);
  }

  async searchAccounts(
    username: string,
    token?: string,
    options?: RecNetRequestOptions
  ): Promise<AccountInfo[]> {
    const accounts = await this.http.requestOrThrow<PlayerResult[]>(
      {
        url: `https://apim.rec.net/accounts/account/search?name=${encodeURIComponent(username)}`,
        method: 'GET',
      },
      token,
      options
    );
    return this.normalizeAccounts(accounts);
  }
  private normalizeAccounts(accounts: PlayerResult[]): PlayerResult[] {
    return accounts.map(account => this.normalizeAccount(account));
  }

  private normalizeAccount(account: PlayerResult): PlayerResult {
      return {
        ...account,
        accountId: String(account.accountId),
      };
  }
}
