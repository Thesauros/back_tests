import { CurveModel, RateCurve, curveModel, modelMarginal } from './valuation';

export interface WaterFillingResult {
  /** Target per provider, asset units; sums to the total exactly. */
  readonly amounts: bigint[];
  /** The water level: the marginal APR (fraction) every partly filled provider sits at. */
  readonly lambda: number;
}

/** Bisection on lambda stops earlier once the bracket is two adjacent doubles. */
const MAX_BISECTIONS = 200;

/**
 * Impact-aware optimum: equalize marginal APR across providers (KKT) under the
 * box 0 <= x_i <= cap_i, with sum x_i = total.
 *
 * Pass cap 0 for an unhealthy provider: it gets no new money and keeps
 * nothing. The entry provider is uncapped (cap = total), so the problem is
 * always feasible. Ties at the water level, flooring dust included, go to the
 * entry provider first, then by provider index. Deterministic: float math
 * decides the level, every amount is an exact bigint.
 */
export function solveWaterFilling(
  providers: readonly (RateCurve & { readonly cap: bigint })[],
  entry: number,
  total: bigint
): WaterFillingResult {
  // Without an uncapped entry the caps may not hold the total, and the sum would silently fall short.
  if (providers[entry] === undefined) throw new RangeError(`Entry provider ${entry} is not one of the providers`);
  if (total <= 0n) return { amounts: providers.map(() => 0n), lambda: Infinity };

  const models = providers.map(curveModel);
  const caps = providers.map(({ cap }, i) => (i === entry || cap > total ? total : cap < 0n ? 0n : cap));
  const fill = (lambda: number) => models.map((model, i) => amountAt(model, caps[i], lambda));
  const sum = (amounts: bigint[]) => amounts.reduce((acc, amount) => acc + amount, 0n);

  // Above every first-unit marginal nothing is filled; below every at-cap one all is.
  const top = Math.max(...models.map((model) => modelMarginal(model, 1)));
  const bottom = Math.min(...models.map((model, i) => modelMarginal(model, Number(caps[i]))));
  let hi = top + Math.abs(top) + 1;
  let lo = bottom - Math.abs(bottom) - 1;
  for (let step = 0; step < MAX_BISECTIONS; step++) {
    const mid = (lo + hi) / 2;
    if (mid <= lo || mid >= hi) break;
    const amounts = fill(mid);
    const placed = sum(amounts);
    if (placed === total) return { amounts, lambda: mid };
    if (placed > total) lo = mid;
    else hi = mid;
  }

  // fill(hi) places less than the total and fill(lo) at least all of it (at
  // the start every provider is at its cap, the entry's being the total); the
  // difference is the units whose marginal sits on the water level.
  const amounts = fill(hi);
  const ceiling = fill(lo);
  let remaining = total - sum(amounts);
  for (const i of [entry, ...[...providers.keys()].filter((index) => index !== entry)]) {
    if (remaining === 0n) break;
    const room = ceiling[i] - amounts[i];
    const take = room < remaining ? room : remaining;
    if (take > 0n) {
      amounts[i] += take;
      remaining -= take;
    }
  }
  return { amounts, lambda: lo };
}

/** Largest amount in [0, cap] whose last unit still earns at least lambda. */
function amountAt(model: CurveModel, cap: bigint, lambda: number): bigint {
  if (cap === 0n || modelMarginal(model, 1) < lambda) return 0n;
  if (modelMarginal(model, Number(cap)) >= lambda) return cap;
  let lo = 1n;
  let hi = cap;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (modelMarginal(model, Number(mid)) >= lambda) lo = mid;
    else hi = mid;
  }
  return lo;
}
