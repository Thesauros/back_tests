// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

// Never deployed. collect-history.ts injects the runtime bytecode with an eth_call state
// override at its own address, next to TangemLens, which stays as it is. This lens reads the
// venues Thesauros has no provider adapter for yet, each the way an adapter of its family
// would report it: a Morpho Vault V2, a single Morpho Blue market, a Fluid fToken and the
// Spark USDC Vault (sUSDC). The same override gives the lens its USDC.
//
// Rebuild lens-wide.bytecode.json after an edit, in a forge project that holds this file only:
//   foundry.toml: solc = "0.8.33", optimizer = true, optimizer_runs = 200,
//                 evm_version = "cancun", bytecode_hash = "none", cbor_metadata = false
//   forge build, then copy deployedBytecode.object of out/TangemLensWide.sol/TangemLensWide.json
// cancun is pinned: the code runs inside blocks from October 2025 on, before Osaka.

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IERC4626 {
    function deposit(uint256 assets, address receiver) external returns (uint256);
}

struct MarketParams {
    address loanToken;
    address collateralToken;
    address oracle;
    address irm;
    uint256 lltv;
}

struct Market {
    uint128 totalSupplyAssets;
    uint128 totalSupplyShares;
    uint128 totalBorrowAssets;
    uint128 totalBorrowShares;
    uint128 lastUpdate;
    uint128 fee;
}

interface IMorpho {
    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
    function market(bytes32 id) external view returns (Market memory);
    function position(bytes32 id, address user) external view returns (uint256 supplyShares, uint128, uint128);
    function supply(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes memory data
    ) external returns (uint256, uint256);
}

interface IIrm {
    function borrowRateView(MarketParams memory marketParams, Market memory market) external view returns (uint256);
}

interface IMetaMorpho {
    function MORPHO() external view returns (address);
    function withdrawQueueLength() external view returns (uint256);
    function withdrawQueue(uint256 index) external view returns (bytes32);
    function fee() external view returns (uint96);
    function maxWithdraw(address owner) external view returns (uint256);
}

interface IVaultV2 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function adaptersLength() external view returns (uint256);
    function adapters(uint256 index) external view returns (address);
    function liquidityAdapter() external view returns (address);
    function liquidityData() external view returns (bytes memory);
    function performanceFee() external view returns (uint96);
    function managementFee() external view returns (uint96);
    function maxRate() external view returns (uint64);
}

interface IAdapter {
    function realAssets() external view returns (uint256);
    // MorphoVaultV1Adapter only.
    function morphoVaultV1() external view returns (address);
    // MorphoMarketV1AdapterV2 only.
    function morpho() external view returns (address);
    function marketIdsLength() external view returns (uint256);
    function marketIds(uint256 index) external view returns (bytes32);
    function expectedSupplyAssets(bytes32 marketId) external view returns (uint256);
}

interface IFluidLiquidity {
    function readFromStorage(bytes32 slot) external view returns (uint256);
}

interface IUsdcVault {
    function ssr() external view returns (uint256);
    function tout() external view returns (uint256);
    function psm() external view returns (address);
}

interface IPsm {
    function pocket() external view returns (address);
}

contract TangemLensWide {
    // TangemLens keeps 0 to 2. `market` is the venue's address in a word, or the market id.
    uint8 internal constant VAULT_V2 = 3; // the Vault V2
    uint8 internal constant MARKET = 4; // the Morpho Blue market id
    uint8 internal constant FLUID = 5; // the fToken
    uint8 internal constant SUSDC = 6; // UsdcVault

    /// The same address on Ethereum and Base.
    IMorpho internal constant MORPHO = IMorpho(0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb);
    /// The same address on Ethereum and Base; fToken.getData() returns it.
    IFluidLiquidity internal constant FLUID_LIQUIDITY = IFluidLiquidity(0x52Aa899454998Be5b000Ad077a46Bbe360F4e497);
    uint256 internal constant WAD = 1e18;
    uint256 internal constant RAY = 1e27;
    uint256 internal constant YEAR = 365 days;
    /// What rateAfter gives when the venue took the deposit and this lens could not read its rate.
    uint256 internal constant RATE_UNREAD = type(uint256).max - 1;

    /// The rate a venue pays once `amount` of ours is in it, in ray: the deposit runs through
    /// the venue's own code and is rolled back. type(uint256).max when the venue refuses the
    /// deposit (a cap, a gate, a pause, a PSM that cannot take it). RATE_UNREAD when the deposit
    /// went through and rate() then reverted: that is this lens failing, not the venue refusing.
    function rateAfter(uint8 kind, address asset, bytes32 market, uint256 amount) external returns (uint256) {
        try this.depositThenRevert(kind, asset, market, amount) {} catch (bytes memory result) {
            if (result.length == 32) return abi.decode(result, (uint256));
        }
        return type(uint256).max;
    }

    /// Always reverts: with the 32-byte rate (or RATE_UNREAD) when the deposit went through, with
    /// the venue's own error otherwise (call it directly to read why a deposit is refused).
    function depositThenRevert(uint8 kind, address asset, bytes32 market, uint256 amount) external {
        if (kind == MARKET) {
            IERC20(asset).approve(address(MORPHO), amount);
            MORPHO.supply(MORPHO.idToMarketParams(market), amount, 0, address(this), "");
        } else {
            // Vault V2, fToken and UsdcVault all take the ERC-4626 call.
            IERC20(asset).approve(_address(market), amount);
            IERC4626(_address(market)).deposit(amount, address(this));
        }
        // Through an outside call, so that a revert of the reading is told from one of the deposit.
        uint256 result = RATE_UNREAD;
        try this.rate(kind, asset, market) returns (uint256 r) {
            result = r;
        } catch {}
        assembly {
            mstore(0, result)
            revert(0, 32)
        }
    }

    /// The deposit rate at this block in ray, 1e27 = 100% a year, as a provider adapter of the
    /// venue's family would report it. Reverts on a venue that is not there yet and on a kind
    /// this lens does not know. The Morpho kinds compound the borrow rate over a year, as
    /// MorphoProvider does, and so read above the growth of the index taken as a simple rate;
    /// Fluid and sUSDC are simple yearly rates.
    function rate(uint8 kind, address asset, bytes32 market) public view returns (uint256 r) {
        if (kind == VAULT_V2) {
            r = v2Rate(IVaultV2(_address(market)));
        } else if (kind == MARKET) {
            (r, , , ) = blueMarket(market, 0);
        } else if (kind == FLUID) {
            require(_address(market).code.length != 0);
            (, r) = fluidRate(asset);
        } else if (kind == SUSDC) {
            // The Sky Savings Rate per second, times a year, as CompoundV3Provider scales its own.
            r = (IUsdcVault(_address(market)).ssr() - RAY) * YEAR;
        } else {
            revert();
        }
    }

    /// What the venue could pay out on demand now, without us in it.
    function withdrawable(uint8 kind, address asset, bytes32 market) external view returns (uint256 w) {
        if (kind == VAULT_V2) {
            (w, ) = v2Withdrawable(IVaultV2(_address(market)));
        } else if (kind == MARKET) {
            (, , , w) = blueMarket(market, 0);
        } else if (kind == FLUID) {
            require(_address(market).code.length != 0);
            w = fluidWithdrawable(_address(market), asset);
        } else if (kind == SUSDC) {
            // UsdcVault.maxWithdraw without the owner's balance: the USDC in the pocket of the
            // Sky LitePSM the vault redeems through, nothing while the PSM's buy side is halted.
            IUsdcVault vault = IUsdcVault(_address(market));
            w = vault.tout() == type(uint256).max ? 0 : IERC20(asset).balanceOf(IPsm(vault.psm()).pocket());
        } else {
            revert();
        }
    }

    function _address(bytes32 market) internal pure returns (address) {
        return address(uint160(uint256(market)));
    }

    // ----------------------------------------------------------------------------------------
    // Morpho Blue: one market, a MetaMorpho vault, a Vault V2.
    // ----------------------------------------------------------------------------------------

    /// A single Morpho Blue market as a venue, accrued to this block: the supply rate in ray by
    /// MorphoProvider's per-market formula, net of the market fee; the assets `shares` supply
    /// shares are worth (the growth index); the total supplied; the unborrowed liquidity.
    /// Reverts on a market that is not created yet.
    function blueMarket(bytes32 id, uint256 shares)
        public
        view
        returns (uint256 marketRate, uint256 index, uint256 supplied, uint256 liquidity)
    {
        require(MORPHO.market(id).lastUpdate != 0);
        uint256 supplyShares;
        (marketRate, supplied, supplyShares, liquidity) = _market(MORPHO, id);
        marketRate *= 1e9;
        // SharesMathLib.toAssetsDown: one virtual asset, 1e6 virtual shares.
        index = (shares * (supplied + 1)) / (supplyShares + 1e6);
    }

    /// A Morpho Blue market accrued to this block: the supply rate as MorphoProvider computes
    /// it (borrow APY x (1 - market fee) x utilization, 1e18 = 100% a year), the totals as
    /// MorphoBalancesLib.expectedMarketBalances gives them, and the unborrowed liquidity.
    function _market(IMorpho morpho, bytes32 id)
        internal
        view
        returns (uint256 marketRate, uint256 supplyAssets, uint256 supplyShares, uint256 liquidity)
    {
        MarketParams memory params = morpho.idToMarketParams(id);
        Market memory m = morpho.market(id);
        supplyAssets = m.totalSupplyAssets;
        supplyShares = m.totalSupplyShares;
        uint256 borrowAssets = m.totalBorrowAssets;
        // Interest adds the same amount to supply and to borrow: liquidity needs no accrual.
        liquidity = supplyAssets - borrowAssets;
        if (params.irm == address(0)) return (0, supplyAssets, supplyShares, liquidity);

        uint256 borrowRate = IIrm(params.irm).borrowRateView(params, m);
        uint256 elapsed = block.timestamp - m.lastUpdate;
        if (elapsed != 0 && borrowAssets != 0) {
            uint256 interest = (borrowAssets * _taylor(borrowRate, elapsed)) / WAD;
            borrowAssets += interest;
            supplyAssets += interest;
            if (m.fee != 0) {
                uint256 feeAmount = (interest * m.fee) / WAD;
                supplyShares += (feeAmount * (supplyShares + 1e6)) / (supplyAssets - feeAmount + 1);
            }
        }
        // wDivUp, as MorphoProvider._getMarketRate.
        uint256 utilization = borrowAssets == 0 ? 0 : (borrowAssets * WAD + (supplyAssets - 1)) / supplyAssets;
        marketRate = (((_taylor(borrowRate, 365 days) * (WAD - m.fee)) / WAD) * utilization) / WAD;
    }

    /// MathLib.wTaylorCompounded: three terms of e^(x n) - 1.
    function _taylor(uint256 x, uint256 n) internal pure returns (uint256) {
        uint256 first = x * n;
        uint256 second = (first * first) / (2 * WAD);
        return first + second + (second * first) / (3 * WAD);
    }

    /// The deployed MorphoProvider.getDepositRate for any MetaMorpho vault, before its scaling
    /// to ray: 1e18 = 100% a year. The deployed providers divide by the sum of the vault's
    /// market positions, not by MetaMorpho.totalAssets() (audit fix THES2-3). Exposed so the
    /// collector can check this lens against the deployed providers.
    function v1Rate(IMetaMorpho v1) public view returns (uint256) {
        IMorpho morpho = IMorpho(v1.MORPHO());
        uint256 length = v1.withdrawQueueLength();
        uint256 ratio;
        uint256 total;
        for (uint256 i; i < length; i++) {
            bytes32 id = v1.withdrawQueue(i);
            (uint256 marketRate, uint256 supplyAssets, uint256 supplyShares, ) = _market(morpho, id);
            (uint256 shares, , ) = morpho.position(id, address(v1));
            // SharesMathLib.toAssetsDown, then wMulDown.
            uint256 assets = (shares * (supplyAssets + 1)) / (supplyShares + 1e6);
            ratio += (marketRate * assets) / WAD;
            total += assets;
        }
        return total == 0 ? 0 : (ratio * (WAD - v1.fee())) / total;
    }

    /// The V1 vault behind a MorphoVaultV1Adapter, or zero for any other adapter.
    function _v1Of(address adapter) internal view returns (address v1) {
        (bool ok, bytes memory out) = adapter.staticcall(abi.encodeCall(IAdapter.morphoVaultV1, ()));
        if (ok && out.length == 32) v1 = abi.decode(out, (address));
    }

    /// What a Thesauros provider for this Vault V2 would return from getDepositRate, in ray:
    /// the asset-weighted rate of what the adapters hold (a V1 vault by MorphoProvider's own
    /// formula, a Morpho Blue market by its supply rate, idle at zero) over the vault's
    /// totalAssets, capped at maxRate, less the performance and the management fee.
    /// Reverts on an adapter that holds assets and is neither of the two Morpho kinds, so an
    /// unknown adapter gives no reading rather than a wrong one.
    function v2Rate(IVaultV2 vault) public view returns (uint256) {
        uint256 total = vault.totalAssets();
        if (total == 0) return 0;
        uint256 weighted;
        uint256 length = vault.adaptersLength();
        for (uint256 i; i < length; i++) {
            IAdapter adapter = IAdapter(vault.adapters(i));
            uint256 held = adapter.realAssets();
            if (held == 0) continue;
            address v1 = _v1Of(address(adapter));
            if (v1 != address(0)) {
                weighted += v1Rate(IMetaMorpho(v1)) * held;
                continue;
            }
            IMorpho morpho = IMorpho(adapter.morpho());
            uint256 markets = adapter.marketIdsLength();
            for (uint256 j; j < markets; j++) {
                bytes32 id = adapter.marketIds(j);
                (uint256 marketRate, , , ) = _market(morpho, id);
                weighted += marketRate * adapter.expectedSupplyAssets(id);
            }
        }
        uint256 gross = weighted / total;
        // VaultV2.accrueInterestView: the share price cannot grow faster than maxRate (per second).
        uint256 cap = uint256(vault.maxRate()) * 365 days;
        if (gross > cap) gross = cap;
        // The performance fee is a cut of the distributed interest, the management fee of the assets.
        uint256 net = (gross * (WAD - vault.performanceFee())) / WAD;
        uint256 management = uint256(vault.managementFee()) * 365 days;
        return net > management ? (net - management) * 1e9 : 0;
    }

    /// What the vault can pay out in one transaction now.
    /// `instant`: what withdraw() and redeem() reach without a penalty, the idle balance plus
    /// what the liquidity adapter can pull from the one place liquidityData names.
    /// `withForceDeallocate`: the same plus every other holding that is liquid now; a holder
    /// reaches it by calling forceDeallocate first and paying forceDeallocatePenalty on the
    /// amount moved.
    /// The market's liquidity is not the vault's alone: the market as a venue and every other
    /// vault that names it report the same USDC. When all of the vault is liquid, `instant` is
    /// totalAssets, one unit more than all the shares there are can withdraw.
    function v2Withdrawable(IVaultV2 vault) public view returns (uint256 instant, uint256 withForceDeallocate) {
        instant = IERC20(vault.asset()).balanceOf(address(vault));
        withForceDeallocate = instant;
        address liquidityAdapter = vault.liquidityAdapter();
        // For a market adapter liquidityData is abi.encode(MarketParams): its hash is the market id.
        bytes32 liquidityMarket = keccak256(vault.liquidityData());
        uint256 length = vault.adaptersLength();
        for (uint256 i; i < length; i++) {
            IAdapter adapter = IAdapter(vault.adapters(i));
            if (adapter.realAssets() == 0) continue;
            address v1 = _v1Of(address(adapter));
            if (v1 != address(0)) {
                // MetaMorpho.maxWithdraw: the adapter's claim, limited by its withdraw queue's liquidity.
                uint256 available = IMetaMorpho(v1).maxWithdraw(address(adapter));
                withForceDeallocate += available;
                if (address(adapter) == liquidityAdapter) instant += available;
                continue;
            }
            IMorpho morpho = IMorpho(adapter.morpho());
            uint256 markets = adapter.marketIdsLength();
            for (uint256 j; j < markets; j++) {
                bytes32 id = adapter.marketIds(j);
                (, , , uint256 liquidity) = _market(morpho, id);
                uint256 own = adapter.expectedSupplyAssets(id);
                uint256 available = own < liquidity ? own : liquidity;
                withForceDeallocate += available;
                if (address(adapter) == liquidityAdapter && id == liquidityMarket) instant += available;
            }
        }
    }

    // ----------------------------------------------------------------------------------------
    // Fluid. The fToken exposes no rate; it lives in the Liquidity layer's packed storage.
    // Ported from LiquidityCalcs (calcExchangePrices, calcBorrowRateFromUtilization,
    // calcWithdrawalLimitBeforeOperate) and UserModule.operate; slots from LiquiditySlotsLink.
    // ----------------------------------------------------------------------------------------

    /// `accruing`: the rate the supply exchange price grows at right now, from the stored borrow
    /// rate and utilization. Liquidity rewrites those only when utilization moves by more than
    /// its update threshold or a day has passed, so after a small deposit it can lag.
    /// `atUtilization`: the same formula on utilization recomputed from the totals, which is
    /// what the stored word becomes at the next rewrite. This is the one rate() returns.
    /// Both in ray, a simple yearly rate.
    function fluidRate(address asset) public view returns (uint256 accruing, uint256 atUtilization) {
        uint256 w = FLUID_LIQUIDITY.readFromStorage(keccak256(abi.encode(asset, uint256(5))));
        uint256 yield = _fluidYield(w & 0xffff, (w >> 16) & 0x3fff, (w >> 30) & 0x3fff, (w >> 219) & 0x7fff, (w >> 234) & 0x7fff);
        accruing = yield * 1e15;
        atUtilization = _fluidAtUtilization(asset, w, yield) * 1e15;
    }

    function _fluidAtUtilization(address asset, uint256 w, uint256 yield) private view returns (uint256) {
        (uint256 supplyPrice, uint256 borrowPrice) = _fluidPrices(w, yield);
        uint256 t = FLUID_LIQUIDITY.readFromStorage(keccak256(abi.encode(asset, uint256(7))));
        uint256 supplyInterest = (_big(t & 0xffffffffffffffff) * supplyPrice) / 1e12;
        uint256 supplyFree = _big((t >> 64) & 0xffffffffffffffff);
        uint256 borrowInterest = (_big((t >> 128) & 0xffffffffffffffff) * borrowPrice) / 1e12;
        uint256 borrowFree = _big((t >> 192) & 0xffffffffffffffff);
        uint256 utilization = supplyInterest + supplyFree == 0
            ? 0
            : ((borrowInterest + borrowFree) * 1e4) / (supplyInterest + supplyFree);
        return
            _fluidYield(
                _fluidBorrowRate(FLUID_LIQUIDITY.readFromStorage(keccak256(abi.encode(asset, uint256(6)))), utilization),
                (w >> 16) & 0x3fff,
                utilization,
                _fluidRatio(supplyInterest, supplyFree),
                _fluidRatio(borrowInterest, borrowFree)
            );
    }

    /// What the fToken can pay out now: the lesser of its withdrawal-limit headroom at the
    /// Liquidity layer and the USDC the layer holds. fToken.maxWithdraw(owner) is this figure
    /// capped by the owner's balance.
    function fluidWithdrawable(address fToken, address asset) public view returns (uint256 available) {
        uint256 w = FLUID_LIQUIDITY.readFromStorage(keccak256(abi.encode(asset, uint256(5))));
        uint256 yield = _fluidYield(w & 0xffff, (w >> 16) & 0x3fff, (w >> 30) & 0x3fff, (w >> 219) & 0x7fff, (w >> 234) & 0x7fff);
        (uint256 price, ) = _fluidPrices(w, yield);

        uint256 u = FLUID_LIQUIDITY.readFromStorage(
            keccak256(abi.encode(asset, keccak256(abi.encode(fToken, uint256(8)))))
        );
        uint256 supplied = _big((u >> 1) & 0xffffffffffffffff);
        uint256 limit = _big((u >> 65) & 0xffffffffffffffff);
        if (limit != 0) {
            // The floor falls from its last value by expandPercent of the supply over expandDuration.
            uint256 expandable = (((u >> 162) & 0x3fff) * supplied) / 1e4;
            uint256 expanded = (expandable * (block.timestamp - ((u >> 129) & 0x1ffffffff))) / ((u >> 176) & 0xffffff);
            limit = limit > expanded ? limit - expanded : 0;
            if (supplied - expandable > limit) limit = supplied - expandable;
        }
        limit = (limit * price) / 1e12;
        supplied = (supplied * price) / 1e12;
        available = supplied > limit ? supplied - limit : 0;
        uint256 held = IERC20(asset).balanceOf(address(FLUID_LIQUIDITY));
        if (held < available) available = held;
    }

    /// borrowRate * ratioSupplyYield * (1e4 - fee), each with 1e4 = 100%: the yearly growth of
    /// the supply exchange price in 1e12.
    function _fluidYield(
        uint256 borrowRate,
        uint256 fee,
        uint256 utilization,
        uint256 supplyRatio,
        uint256 borrowRatio
    ) private pure returns (uint256) {
        if (borrowRate == 0 || borrowRatio == 1 || supplyRatio == 1) return 0;
        uint256 t;
        if (supplyRatio & 1 == 1) {
            t = (RAY * 1e4) / (supplyRatio >> 1);
            t = (utilization * (RAY + t)) / 1e4;
        } else {
            t = (RAY * utilization * (1e4 + (supplyRatio >> 1))) / 1e8;
        }
        if (borrowRatio & 1 == 1) {
            borrowRatio = ((borrowRatio >> 1) * RAY) / (1e4 + (borrowRatio >> 1));
        } else {
            borrowRatio = RAY - (((borrowRatio >> 1) * RAY) / (1e4 + (borrowRatio >> 1)));
        }
        return borrowRate * ((1e4 * t * borrowRatio) / 1e54) * (1e4 - fee);
    }

    /// Exchange prices accrued from the last storage write to this block.
    function _fluidPrices(uint256 w, uint256 yield) private view returns (uint256 supplyPrice, uint256 borrowPrice) {
        supplyPrice = (w >> 91) & 0xffffffffffffffff;
        borrowPrice = (w >> 155) & 0xffffffffffffffff;
        uint256 elapsed = block.timestamp - ((w >> 58) & 0x1ffffffff);
        if ((w >> 234) & 0x7fff != 1) borrowPrice += (borrowPrice * (w & 0xffff) * elapsed) / (YEAR * 1e4);
        supplyPrice += (supplyPrice * yield * elapsed) / (YEAR * 1e12);
    }

    /// The smaller side over the larger in 1e4, shifted left, with bit 0 set when the
    /// interest-free side is the larger one.
    function _fluidRatio(uint256 withInterest, uint256 interestFree) private pure returns (uint256) {
        if (withInterest > interestFree) return ((interestFree * 1e4) / withInterest) << 1;
        if (withInterest < interestFree) return (((withInterest * 1e4) / interestFree) << 1) | 1;
        return withInterest == 0 ? 0 : 1e4 << 1;
    }

    /// Rate model versions 1 (one kink) and 2 (two kinks): straight lines between the points.
    function _fluidBorrowRate(uint256 d, uint256 utilization) private pure returns (uint256) {
        uint256 x1;
        uint256 x2 = (d >> 20) & 0xffff;
        uint256 y1 = (d >> 4) & 0xffff;
        uint256 y2 = (d >> 36) & 0xffff;
        if (utilization >= x2) {
            x1 = x2;
            y1 = y2;
            if (d & 0xf == 1) {
                (x2, y2) = (1e4, (d >> 52) & 0xffff);
            } else if (utilization < (d >> 52) & 0xffff) {
                (x2, y2) = ((d >> 52) & 0xffff, (d >> 68) & 0xffff);
            } else {
                (x1, y1, x2, y2) = ((d >> 52) & 0xffff, (d >> 68) & 0xffff, 1e4, (d >> 84) & 0xffff);
            }
        }
        int256 slope = ((int256(y2) - int256(y1)) * 1e12) / int256(x2 - x1);
        int256 y = slope * int256(utilization) + int256(y1 * 1e12) - slope * int256(x1);
        require(y >= 0);
        return uint256(y) / 1e12 > 0xffff ? 0xffff : uint256(y) / 1e12;
    }

    /// BigMath: a coefficient and an 8-bit exponent.
    function _big(uint256 v) private pure returns (uint256) {
        return (v >> 8) << (v & 0xff);
    }
}
