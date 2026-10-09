// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

// Never deployed. collect-history.ts injects the runtime bytecode with an eth_call state
// override, so the code below runs inside the node at any historical block.
// Rebuild lens.bytecode.json after an edit: see the header of collect-history.ts.

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}

interface IProvider {
    function getDepositRate(address vault) external view returns (uint256);
}

interface IComet {
    function supply(address asset, uint256 amount) external;
    function getUtilization() external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint64);
    function totalsBasic()
        external
        view
        returns (uint64, uint64, uint64, uint64, uint104, uint104, uint40, uint8);
}

interface IMetaMorpho {
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function MORPHO() external view returns (address);
    function withdrawQueueLength() external view returns (uint256);
    function withdrawQueue(uint256 index) external view returns (bytes32);
}

interface IMorpho {
    function market(bytes32 id) external view returns (uint128, uint128, uint128, uint128, uint128, uint128);
    function position(bytes32 id, address user) external view returns (uint256, uint128, uint128);
}

contract TangemLens {
    uint8 internal constant AAVE = 0;
    uint8 internal constant COMPOUND = 1;

    /// The rate a venue pays once `amount` of ours is in it, in ray as IProvider reports it:
    /// the deposit runs through the venue's own code and is rolled back. The lens is given
    /// its `asset` balance by the same state override. type(uint256).max when the venue
    /// refuses the deposit (a supply cap, a pause).
    function rateAfterDeposit(
        uint8 kind,
        address asset,
        address market,
        address morphoProvider,
        uint256 amount
    ) external returns (uint256) {
        try this.depositThenRevert(kind, asset, market, morphoProvider, amount) {} catch (bytes memory result) {
            if (result.length == 32) return abi.decode(result, (uint256));
        }
        return type(uint256).max;
    }

    function depositThenRevert(
        uint8 kind,
        address asset,
        address market,
        address morphoProvider,
        uint256 amount
    ) external {
        IERC20(asset).approve(market, amount);
        uint256 rate;
        if (kind == AAVE) {
            IAavePool(market).supply(asset, amount, address(this), 0);
            // getReserveData(address): currentLiquidityRate is the third word of the struct.
            (, bytes memory reserve) = market.staticcall(abi.encodeWithSelector(0x35ea6a75, asset));
            assembly {
                rate := mload(add(reserve, 96))
            }
        } else if (kind == COMPOUND) {
            IComet(market).supply(asset, amount);
            rate = uint256(IComet(market).getSupplyRate(IComet(market).getUtilization())) * 1e9 * 365 days;
        } else {
            IMetaMorpho(market).deposit(amount, address(this));
            rate = IProvider(morphoProvider).getDepositRate(address(0));
        }
        assembly {
            mstore(0, rate)
            revert(0, 32)
        }
    }

    /// Supply rate per second (1e18) and the supply index (1e15) accrued to this block.
    /// The rate is what CompoundV3Provider.getDepositRate reads before it scales to ray.
    function comet(IComet c) external view returns (uint256 ratePerSecond, uint256 supplyIndex) {
        ratePerSecond = c.getSupplyRate(c.getUtilization());
        (uint64 index, , , , , , uint40 lastAccrual, ) = c.totalsBasic();
        supplyIndex = index + (uint256(index) * ratePerSecond * (block.timestamp - lastAccrual)) / 1e18;
    }

    /// What a MetaMorpho vault can pay out now: for each market of its withdraw queue, the
    /// lesser of the vault's own supply and the market's unborrowed liquidity. Totals are as
    /// of each market's last accrual, so this reads a few hours of interest low.
    function morphoWithdrawable(IMetaMorpho vault) external view returns (uint256 withdrawable) {
        IMorpho morpho = IMorpho(vault.MORPHO());
        uint256 length = vault.withdrawQueueLength();
        for (uint256 i; i < length; i++) {
            bytes32 id = vault.withdrawQueue(i);
            (uint128 supplyAssets, uint128 supplyShares, uint128 borrowAssets, , , ) = morpho.market(id);
            (uint256 shares, , ) = morpho.position(id, address(vault));
            // SharesMathLib.toAssetsDown: one virtual asset, 1e6 virtual shares.
            uint256 own = (shares * (uint256(supplyAssets) + 1)) / (uint256(supplyShares) + 1e6);
            uint256 liquid = supplyAssets - borrowAssets;
            withdrawable += own < liquid ? own : liquid;
        }
    }
}
