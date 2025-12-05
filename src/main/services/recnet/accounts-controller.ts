import { AccountInfo } from '../../../shared/types';
import { RecNetHttpClient } from './http-client';

export class AccountsController {
  constructor(private readonly http: RecNetHttpClient) {}

  async fetchBulkAccounts(
    accountIds: string[],
    token?: string
  ): Promise<any[]> {
    if (accountIds.length === 0) {
      return [];
    }

    const results: any[] = [];
    const batchSize = 100;

    for (let i = 0; i < accountIds.length; i += batchSize) {
      const batch = accountIds.slice(i, i + batchSize);

      try {
        const formData = new URLSearchParams();
        for (const id of batch) {
          formData.append('id', id);
        }

        const response = await this.http.request<any[]>(
          {
            url: 'https://accounts.rec.net/account/bulk',
            method: 'POST',
            data: formData.toString(),
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          },
          token
        );

        if (response.success && Array.isArray(response.value)) {
          results.push(...response.value);
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

      if (i + batchSize < accountIds.length) {
        await this.delayBetweenBatches();
      }
    }

    return results;
  }

  async lookupAccount(
    accountId: string,
    token?: string
  ): Promise<AccountInfo[]> {
    return this.http.requestOrThrow<AccountInfo[]>(
      {
        url: `https://accounts.rec.net/account/bulk?id=${encodeURIComponent(accountId)}`,
        method: 'GET',
      },
      token
    );
  }

  async searchAccounts(
    username: string,
    token?: string
  ): Promise<AccountInfo[]> {
    return this.http.requestOrThrow<AccountInfo[]>(
      {
        url: `https://apim.rec.net/accounts/account/search?name=${encodeURIComponent(username)}`,
        method: 'GET',
      },
      token
    );
  }

  private delayBetweenBatches(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 100));
  }
}
