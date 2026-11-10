// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice ABI-compatible slice of Injective's pinned Exchange precompile interface.
/// Source revision: 811a0a1b3e7303234bd42c6d00b47cc464d143ad.
/// Numeric values use Injective API format scaled by 1e18.
interface IExchangeSpotOrderPrecompile {
    struct SpotOrdersRequest {
        string marketID;
        string subaccountID;
        string[] orderHashes;
    }

    struct TrimmedSpotLimitOrder {
        uint256 price;
        uint256 quantity;
        uint256 fillable;
        bool isBuy;
        string orderHash;
        string cid;
    }

    struct SpotOrder {
        string marketID;
        string subaccountID;
        string feeRecipient;
        uint256 price;
        uint256 quantity;
        string cid;
        string orderType;
        uint256 triggerPrice;
    }

    struct CreateSpotLimitOrderResponse {
        string orderHash;
        string cid;
    }

    function createSpotLimitOrder(address sender, SpotOrder calldata order)
        external
        returns (CreateSpotLimitOrderResponse memory response);

    function cancelSpotOrder(address sender, string calldata marketID, string calldata subaccountID, string calldata orderHash, string calldata cid)
        external
        returns (bool success);

    /// @notice Pinned Exchange ABI query; amounts use native denom units.
    function subaccountDeposit(string calldata subaccountID, string calldata denom)
        external view returns (uint256 availableBalance, uint256 totalBalance);

    /// @notice Moves bank-held coins owned by sender into its Exchange subaccount.
    function deposit(address sender, string calldata subaccountID, string calldata denom, uint256 amount)
        external returns (bool success);

    /// @notice Withdraws available Exchange funds to sender's Bank account.
    function withdraw(address sender, string calldata subaccountID, string calldata denom, uint256 amount)
        external returns (bool success);

    /// @notice Returns Exchange funds to an external subaccount. This is not a bank withdrawal.
    function externalTransfer(
        address sender,
        string calldata sourceSubaccountID,
        string calldata destinationSubaccountID,
        string calldata denom,
        uint256 amount
    ) external returns (bool success);

    /// @notice Lists matching active spot orders; an empty result is terminal for the queried hashes.
    function spotOrdersByHashes(SpotOrdersRequest calldata request)
        external returns (TrimmedSpotLimitOrder[] memory orders);
}
