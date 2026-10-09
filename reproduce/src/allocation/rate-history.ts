import { toBigInt } from 'ethers';
import { IProvider__factory, Multicall } from '@backend-ts/typechain';
import { BlockSource, findBlockByTimestamp } from '../block-by-timestamp';
import { RateHistory, RateSample, SignalWindow } from './signal';

/**
 * Past sample times inside the window, oldest first. Quantized to absolute
 * multiples of the step, so a sample time never moves between iterations and
 * its reading is immutable.
 */
export function sampleTimes(nowSeconds: number, window: SignalWindow): number[] {
  const times: number[] = [];
  const newest = Math.floor(nowSeconds / window.stepSeconds) * window.stepSeconds - window.stepSeconds;
  for (let time = newest; nowSeconds - time <= window.windowSeconds; time -= window.stepSeconds) {
    times.unshift(time);
  }
  return times;
}

const providerInterface = IProvider__factory.createInterface();

/** Map in insertion order, refreshed on read: the first key is the least recently used. */
class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value);
  }
}

export interface RateHistoryRequest {
  /** Cache namespace, e.g. the NetworkEnum value. */
  readonly network: string;
  readonly blocks: BlockSource;
  /** The network's aggregator (`multicalls[network]`). */
  readonly multicall: Pick<Multicall, 'tryAggregate'>;
  /** The address getDepositRate is asked about (the vault or strategy). */
  readonly holder: string;
  readonly providers: readonly string[];
  /** Decision time; pass the head block's timestamp so every reader agrees. */
  readonly nowSeconds: number;
  readonly window: SignalWindow;
}

/**
 * getDepositRate history read from the chain at past block tags — not from
 * Redis, so a flush cannot blind it and a rate pumped right before the read
 * does not count until it holds.
 *
 * One aggregator call per sample time. Past readings and sample-time blocks
 * are cached in memory (bounded, least recently used out); only what is new
 * since the last iteration reaches the RPC. Failures are not cached.
 */
export class RateHistorySampler {
  private readonly rates: LruCache<bigint>;
  private readonly blocks: LruCache<number>;

  constructor(maxEntries = 20_000) {
    this.rates = new LruCache(maxEntries);
    this.blocks = new LruCache(maxEntries);
  }

  /**
   * Never throws into the money path: a provider with any sample unreadable
   * (RPC error, pruned state, no code yet at that block) gets 'unavailable',
   * and rateSignal turns that into 0 for new money.
   */
  public async sample(request: RateHistoryRequest): Promise<RateHistory[]> {
    try {
      return await this.read(request);
    } catch {
      return request.providers.map(() => 'unavailable');
    }
  }

  private async read({
    network,
    blocks,
    multicall,
    holder,
    providers,
    nowSeconds,
    window,
  }: RateHistoryRequest): Promise<RateHistory[]> {
    const samples = providers.map((): RateSample[] => []);
    const failed = providers.map(() => false);
    const rateKey = (provider: string, time: number) =>
      `${network}:${provider.toLowerCase()}:${holder.toLowerCase()}:${time}`;
    const callData = providerInterface.encodeFunctionData('getDepositRate', [holder]);
    let hint: number | undefined;

    for (const time of sampleTimes(nowSeconds, window)) {
      const ageSeconds = nowSeconds - time;
      const missing: number[] = [];
      providers.forEach((provider, i) => {
        if (failed[i]) return;
        const rate = this.rates.get(rateKey(provider, time));
        if (rate === undefined) missing.push(i);
        else samples[i].push({ ageSeconds, rate });
      });

      const blockKey = `${network}:${time}`;
      let block = this.blocks.get(blockKey);
      if (missing.length === 0) {
        hint = block ?? hint;
        continue;
      }

      try {
        // The previous sample time's block is at or before this one: the search starts there.
        block ??= await findBlockByTimestamp(blocks, time, { fromBlock: hint });
        this.blocks.set(blockKey, block);
        hint = block;
        const results = await multicall.tryAggregate.staticCall(
          false,
          missing.map((i) => ({ target: providers[i], callData })),
          { blockTag: block }
        );
        missing.forEach((i, j) => {
          const rate = decodeRate(results[j]);
          if (rate === null) {
            failed[i] = true;
            return;
          }
          this.rates.set(rateKey(providers[i], time), rate);
          samples[i].push({ ageSeconds, rate });
        });
      } catch {
        missing.forEach((i) => (failed[i] = true));
      }
    }

    return providers.map((_, i) => (failed[i] ? 'unavailable' : samples[i]));
  }
}

/** A provider with no code at that block answers success with empty data: that is a failure too. */
function decodeRate(result: { success: boolean; returnData: string } | undefined): bigint | null {
  if (!result?.success) return null;
  try {
    return toBigInt(providerInterface.decodeFunctionResult('getDepositRate', result.returnData)[0]);
  } catch {
    return null;
  }
}
