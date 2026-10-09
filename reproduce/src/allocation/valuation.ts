import { rayDecimals } from '../ray';

const RAY = 10 ** rayDecimals;

/**
 * One provider as the allocation math sees it.
 *
 * Entry/exit asymmetry: the first `held` units are valued on the spot curve
 * (keeping or exiting is judged by spot), every unit above on the signal curve
 * (entering is judged by min(spot, EWMA)). signal <= spot keeps the marginal
 * non-increasing, so greedy and water-filling stay exact.
 */
export interface RateCurve {
  /** getDepositRate now, at our current position, ray. */
  readonly spot: bigint;
  /** min(spot, EWMA), ray. Clamped to spot. */
  readonly signal: bigint;
  /** What we hold in the provider before this plan, asset units. Incoming cash is not held. */
  readonly held: bigint;
  /** Impact exponent of r(x) = r0 * (T / (T + x))^alpha; 0 or absent is a flat rate. */
  readonly alpha?: number;
  /** Total supply of the market, our position included, asset units. Only read when alpha > 0. */
  readonly marketSize?: bigint;
}

export interface CurveModel {
  readonly held: number;
  /** Market size without us, at least 1. */
  readonly rest: number;
  readonly alpha: number;
  /** r0 of the spot and signal curves, APR fraction, calibrated so r(held) is the observation. */
  readonly spot0: number;
  readonly signal0: number;
  /**
   * Past 2T / (alpha - 1) the true marginal turns back up (it is negative by
   * then); the marginal is held flat there to stay non-increasing.
   */
  readonly turn: number;
}

export function curveModel(curve: RateCurve): CurveModel {
  const alpha = curve.alpha ?? 0;
  const held = Number(curve.held);
  const spot = Number(curve.spot) / RAY;
  const signal = Number(curve.signal < curve.spot ? curve.signal : curve.spot) / RAY;
  const restUnits = (curve.marketSize ?? 0n) - curve.held;
  const rest = alpha === 0 ? 1 : Number(restUnits > 1n ? restUnits : 1n);
  const lift = ((rest + held) / rest) ** alpha;
  return {
    held,
    rest,
    alpha,
    spot0: spot * lift,
    signal0: signal * lift,
    turn: alpha > 1 ? (2 * rest) / (alpha - 1) : Infinity,
  };
}

/** d/dx of x * r(x) = r(x) * (1 - alpha * x / (T + x)), flat past the turn. */
function curveMarginal(model: CurveModel, r0: number, x: number): number {
  const at = Math.min(x, model.turn);
  const { rest, alpha } = model;
  return r0 * (rest / (rest + at)) ** alpha * (1 - (alpha * at) / (rest + at));
}

/** Marginal APR of the unit ending at `amount`: spot curve up to `held`, signal curve above. */
export function modelMarginal(model: CurveModel, amount: number): number {
  const spot = curveMarginal(model, model.spot0, Math.min(amount, model.held));
  if (amount <= model.held) return spot;
  return Math.min(spot, curveMarginal(model, model.signal0, amount));
}

/** Marginal APR (fraction) of the unit ending at `amount`; the water level is compared against it. */
export function marginalRate(curve: RateCurve, amount: bigint): number {
  return modelMarginal(curveModel(curve), Number(amount));
}

/** x * r(x) on one curve, asset units per year. */
function revenue(model: CurveModel, r0: number, x: number): number {
  return x * r0 * (model.rest / (model.rest + x)) ** model.alpha;
}

/** Y(x): annual yield of `amount` in the provider, the integral of the marginal. Continuous at `held`. */
export function allocationYield(curve: RateCurve, amount: bigint): number {
  const model = curveModel(curve);
  const x = Number(amount);
  if (x <= model.held) return revenue(model, model.spot0, x);
  return (
    revenue(model, model.spot0, model.held) +
    revenue(model, model.signal0, x) -
    revenue(model, model.signal0, model.held)
  );
}

/** G = sum Y(target) - sum Y(baseline): annual gain of the target over the baseline, asset units. */
export function allocationGain(
  curves: readonly RateCurve[],
  target: readonly bigint[],
  baseline: readonly bigint[]
): number {
  return curves.reduce(
    (gain, curve, i) => gain + allocationYield(curve, target[i]) - allocationYield(curve, baseline[i]),
    0
  );
}
