// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// The parts of a Compound III (Comet) market that savings plans use.
/// `balanceOf` is the supplier's base balance with interest, and grows by itself.
interface IComet {
    function baseToken() external view returns (address);
    function supply(address asset, uint256 amount) external;
    function supplyTo(address dst, address asset, uint256 amount) external;
    function withdrawTo(address to, address asset, uint256 amount) external;
    function balanceOf(address owner) external view returns (uint256);
    function getUtilization() external view returns (uint256);
    function getSupplyRate(uint256 utilization) external view returns (uint64);
}
