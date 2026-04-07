import { axiosRequest } from '../../../utils/axiosRequest';
import { RecNetHttpClient } from '../http-client';

jest.mock('../../../utils/axiosRequest', () => ({
  axiosRequest: jest.fn(),
}));

const mockAxiosRequest = axiosRequest as jest.MockedFunction<typeof axiosRequest>;

describe('RecNetHttpClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-06T12:00:00.000Z'));
    mockAxiosRequest.mockReset();
    mockAxiosRequest.mockResolvedValue({
      success: true,
      value: { ok: true },
      status: 200,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('enforces the configured delay between request starts', async () => {
    const requestTimes: number[] = [];
    mockAxiosRequest.mockImplementation(async config => {
      requestTimes.push(Date.now());
      return {
        success: true,
        value: config.url ?? 'ok',
        status: 200,
      };
    });

    const client = new RecNetHttpClient();
    client.setRequestDelayMs(100);

    const firstRequest = client.request({ url: 'https://example.com/first' });
    const secondRequest = client.request({ url: 'https://example.com/second' });

    await jest.advanceTimersByTimeAsync(0);
    expect(mockAxiosRequest).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(99);
    expect(mockAxiosRequest).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1);
    await Promise.all([firstRequest, secondRequest]);

    expect(mockAxiosRequest).toHaveBeenCalledTimes(2);
    expect(requestTimes).toHaveLength(2);
    expect(requestTimes[1] - requestTimes[0]).toBe(100);
  });

  it('cancels a delayed request before it reaches the transport', async () => {
    const client = new RecNetHttpClient();
    client.setRequestDelayMs(100);

    const firstRequest = client.request({ url: 'https://example.com/first' });
    const controller = new AbortController();
    const secondRequest = client.request(
      { url: 'https://example.com/second' },
      undefined,
      { signal: controller.signal }
    );

    await jest.advanceTimersByTimeAsync(0);
    expect(mockAxiosRequest).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(50);
    controller.abort();

    await expect(secondRequest).rejects.toThrow('Operation cancelled');
    await firstRequest;

    expect(mockAxiosRequest).toHaveBeenCalledTimes(1);
  });
});
