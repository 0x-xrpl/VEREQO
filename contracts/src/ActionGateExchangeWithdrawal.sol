// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IExchangeSpotOrderPrecompile} from "./IExchangeSpotOrderPrecompile.sol";

/// @notice Immutable delegatecall logic used only to keep ActionGate below EIP-170.
/// It has no storage and performs a Direct withdraw as the calling Gate address.
contract ActionGateExchangeWithdrawal {
    address private constant EXCHANGE_PRECOMPILE = address(0x65);
    address private immutable SELF;

    constructor() { SELF = address(this); }

    function withdrawQuote(address asset, string calldata subaccount, string calldata denom, uint256 amount)
        external returns (uint256 availableBefore, uint256 bankBalanceAfter)
    {
        require(address(this) != SELF, "DELEGATE_ONLY");
        require(amount != 0, "WITHDRAW_AMOUNT");
        uint256 totalBefore;
        (availableBefore, totalBefore) = IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(subaccount, denom);
        require(availableBefore >= amount && totalBefore >= amount, "EXCHANGE_AVAILABLE_BALANCE");
        uint256 bankBalanceBefore = _balanceOf(asset);
        try IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).withdraw(address(this), subaccount, denom, amount) returns (bool success) {
            require(success, "EXCHANGE_WITHDRAW_FAILED");
        } catch { revert("EXCHANGE_WITHDRAW_FAILED"); }
        (uint256 availableAfter, uint256 totalAfter) = IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(subaccount, denom);
        require(availableAfter == availableBefore - amount && totalAfter == totalBefore - amount, "EXCHANGE_WITHDRAW_BALANCE_MISMATCH");
        bankBalanceAfter = _balanceOf(asset);
        require(bankBalanceAfter >= bankBalanceBefore && bankBalanceAfter - bankBalanceBefore == amount, "EXCHANGE_WITHDRAW_CREDIT_MISMATCH");
    }

    function depositQuote(address asset, string calldata subaccount, string calldata denom, uint256 amount)
        external returns (uint256 availableBefore, uint256 availableAfter, uint256 bankBalanceAfter)
    {
        require(address(this) != SELF, "DELEGATE_ONLY");
        require(amount != 0, "DEPOSIT_AMOUNT");
        uint256 totalBefore;
        (availableBefore, totalBefore) = IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(subaccount, denom);
        uint256 bankBalanceBefore = _balanceOf(asset);
        require(bankBalanceBefore >= amount, "BANK_AVAILABLE_BALANCE");
        try IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).deposit(address(this), subaccount, denom, amount) returns (bool success) {
            require(success, "EXCHANGE_DEPOSIT_FAILED");
        } catch { revert("EXCHANGE_DEPOSIT_FAILED"); }
        uint256 totalAfter;
        (availableAfter, totalAfter) = IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(subaccount, denom);
        require(availableAfter == availableBefore + amount && totalAfter == totalBefore + amount, "EXCHANGE_DEPOSIT_BALANCE_MISMATCH");
        bankBalanceAfter = _balanceOf(asset);
        require(bankBalanceBefore >= bankBalanceAfter && bankBalanceBefore - bankBalanceAfter == amount, "EXCHANGE_DEPOSIT_DEBIT_MISMATCH");
    }

    /// @notice Return Exchange funds to the principal's Exchange subaccount and reconcile both sides.
    /// This is an Exchange-to-Exchange transfer, not a Bank/EVM withdrawal.
    function transferToPrincipal(string calldata sourceSubaccount, string calldata destinationSubaccount, string calldata denom, uint256 amount)
        external returns (uint256 sourceAvailableBefore)
    {
        require(address(this) != SELF, "DELEGATE_ONLY");
        require(amount != 0, "RECOVERY_AMOUNT");
        uint256 sourceTotalBefore;
        (sourceAvailableBefore, sourceTotalBefore) = IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE)
            .subaccountDeposit(sourceSubaccount, denom);
        require(sourceAvailableBefore >= amount && sourceTotalBefore >= amount, "EXCHANGE_AVAILABLE_BALANCE");
        (uint256 destinationAvailableBefore, uint256 destinationTotalBefore) =
            IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(destinationSubaccount, denom);
        try IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).externalTransfer(
            address(this), sourceSubaccount, destinationSubaccount, denom, amount
        ) returns (bool success) {
            require(success, "EXCHANGE_RECOVERY_FAILED");
        } catch { revert("EXCHANGE_RECOVERY_FAILED"); }
        (uint256 sourceAvailableAfter, uint256 sourceTotalAfter) =
            IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(sourceSubaccount, denom);
        (uint256 destinationAvailableAfter, uint256 destinationTotalAfter) =
            IExchangeSpotOrderPrecompile(EXCHANGE_PRECOMPILE).subaccountDeposit(destinationSubaccount, denom);
        require(
            sourceAvailableAfter == sourceAvailableBefore - amount && sourceTotalAfter == sourceTotalBefore - amount &&
            destinationAvailableAfter == destinationAvailableBefore + amount &&
            destinationTotalAfter == destinationTotalBefore + amount,
            "EXCHANGE_RECOVERY_BALANCE_MISMATCH"
        );
    }

    function _balanceOf(address asset) private view returns (uint256 balance) {
        (bool ok, bytes memory data) = asset.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        require(ok && data.length == 32, "ASSET_BALANCE_QUERY");
        balance = abi.decode(data, (uint256));
    }
}
