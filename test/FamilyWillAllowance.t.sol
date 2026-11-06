// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {FamilyWill} from "../src/FamilyWill.sol";
import {Call} from "../src/interfaces/ICalibur.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// A will for a wallet without Calibur, such as MetaMask: the owner approves
/// the will, and heirs pull their shares after release.
contract FamilyWillAllowanceTest is Base {
    FamilyWill will;
    uint32 constant SILENCE = 180 days;
    uint32 constant WINDOW = 30 days;
    address dad = makeAddr("dad"); // a plain EOA, as MetaMask is

    function setUp() public {
        _fork();
        will = FamilyWill(_hookAddress("zoza.family.will", 0x08));
        deployCodeTo("FamilyWill.sol:FamilyWill", address(will));
        _mintUsdc(dad, 1_000e6);
        vm.deal(dad, 1 ether);
    }

    function _heirs() internal view returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (arjun, meera);
    }

    function _shares() internal pure returns (uint16[] memory s) {
        s = new uint16[](2);
        (s[0], s[1]) = (6_000, 4_000);
    }

    function _usdcOnly() internal pure returns (address[] memory t) {
        t = new address[](1);
        t[0] = USDC;
    }

    function _makeWill() internal {
        vm.startPrank(dad);
        usdc.approve(address(will), type(uint256).max);
        will.makeWillWithAllowance(_heirs(), _shares(), _usdcOnly(), SILENCE, WINDOW);
        vm.stopPrank();
    }

    function _release() internal {
        vm.warp(block.timestamp + SILENCE);
        vm.prank(stranger);
        will.openClaim(dad);
        vm.warp(block.timestamp + WINDOW);
    }

    function test_plainWallet_canWriteAWill() public {
        _makeWill();
        FamilyWill.Will memory w = will.willOf(dad);
        assertTrue(w.pull);
        assertEq(w.heirs.length, 2);
        assertEq(uint8(will.stateOf(dad)), uint8(FamilyWill.State.Alive));
        assertEq(usdc.balanceOf(dad), 1_000e6); // money stays with dad
        assertEq(will.willsNaming(arjun)[0], dad);
    }

    function test_heirsTakeTheirSharesAfterRelease() public {
        _makeWill();
        _release();
        assertEq(will.claimable(dad, arjun, USDC), 600e6);
        vm.prank(arjun);
        will.take(dad, USDC, 600e6);
        vm.prank(meera);
        will.take(dad, USDC, 400e6);
        assertEq(usdc.balanceOf(arjun), 600e6);
        assertEq(usdc.balanceOf(meera), 400e6);
        assertEq(usdc.balanceOf(dad), 0);
    }

    function test_heirCanTakeInParts() public {
        _makeWill();
        _release();
        vm.startPrank(arjun);
        will.take(dad, USDC, 100e6);
        will.take(dad, USDC, 500e6);
        vm.expectRevert(abi.encodeWithSelector(FamilyWill.MoreThanShare.selector, 0));
        will.take(dad, USDC, 1);
        vm.stopPrank();
    }

    function test_nothingMovesWhileTheOwnerIsAround() public {
        _makeWill();
        vm.prank(arjun);
        vm.expectRevert(abi.encodeWithSelector(FamilyWill.NotReleased.selector, uint64(0) + WINDOW));
        will.take(dad, USDC, 1);
        // Silent but no claim yet: still nothing.
        vm.warp(block.timestamp + SILENCE);
        vm.prank(arjun);
        vm.expectRevert();
        will.take(dad, USDC, 1);
        // Claim open, inside the notice period: still nothing.
        will.openClaim(dad);
        vm.warp(block.timestamp + WINDOW - 1);
        vm.prank(arjun);
        vm.expectRevert();
        will.take(dad, USDC, 1);
    }

    function test_checkInCancelsTheClaim() public {
        _makeWill();
        vm.warp(block.timestamp + SILENCE);
        will.openClaim(dad);
        vm.prank(dad);
        will.checkIn();
        vm.warp(block.timestamp + WINDOW);
        assertEq(uint8(will.stateOf(dad)), uint8(FamilyWill.State.Alive));
        vm.prank(arjun);
        vm.expectRevert();
        will.take(dad, USDC, 1);
    }

    function test_heirCannotTakeMoreThanTheirShare() public {
        _makeWill();
        _release();
        vm.prank(meera);
        vm.expectRevert(abi.encodeWithSelector(FamilyWill.MoreThanShare.selector, 400e6));
        will.take(dad, USDC, 400e6 + 1);
    }

    function test_strangerCannotTake() public {
        _makeWill();
        _release();
        vm.prank(stranger);
        vm.expectRevert(FamilyWill.NotAnHeirKey.selector);
        will.take(dad, USDC, 1);
    }

    function test_unlistedTokenCannotBeTaken() public {
        _makeWill();
        _release();
        vm.prank(arjun);
        vm.expectRevert(FamilyWill.TokenNotInWill.selector);
        will.take(dad, address(0xBEEF), 1);
    }

    function test_ethCannotBeInAnAllowanceWill() public {
        address[] memory t = new address[](2);
        (t[0], t[1]) = (USDC, address(0));
        vm.prank(dad);
        vm.expectRevert(FamilyWill.BadWill.selector);
        will.makeWillWithAllowance(_heirs(), _shares(), t, SILENCE, WINDOW);
    }

    function test_sharesFollowASmallerAllowance() public {
        vm.startPrank(dad);
        usdc.approve(address(will), 500e6); // dad leaves only 500 to the will
        will.makeWillWithAllowance(_heirs(), _shares(), _usdcOnly(), SILENCE, WINDOW);
        vm.stopPrank();
        _release();
        assertEq(will.claimable(dad, arjun, USDC), 300e6);
        assertEq(will.claimable(dad, meera, USDC), 200e6);
        vm.prank(arjun);
        will.take(dad, USDC, 300e6);
        vm.prank(meera);
        will.take(dad, USDC, 200e6);
        assertEq(usdc.balanceOf(dad), 500e6);
    }

    function test_revokingEndsTheWill() public {
        _makeWill();
        vm.startPrank(dad);
        will.revokeWill();
        usdc.approve(address(will), 0);
        vm.stopPrank();
        vm.warp(block.timestamp + SILENCE + WINDOW);
        vm.prank(arjun);
        vm.expectRevert(FamilyWill.NotAnAllowanceWill.selector);
        will.take(dad, USDC, 1);
        assertEq(will.willsNaming(arjun).length, 0);
    }

    function test_aNewWillReplacesTheOld() public {
        _makeWill();
        address[] memory h = new address[](1);
        h[0] = meera;
        uint16[] memory s = new uint16[](1);
        s[0] = 10_000;
        vm.prank(dad);
        will.makeWillWithAllowance(h, s, _usdcOnly(), SILENCE, WINDOW);
        _release();
        vm.prank(arjun);
        vm.expectRevert(FamilyWill.NotAnHeirKey.selector);
        will.take(dad, USDC, 1);
        assertEq(will.claimable(dad, meera, USDC), 1_000e6);
    }

    function test_takeIsOnlyForAllowanceWills() public {
        // A Calibur will is paid through heir keys, never `take`.
        _delegate(PRIYA_PK);
        _mintUsdc(priya, 100e6);
        Call[] memory calls = new Call[](5);
        _addKey(calls, 0, arjun, address(will));
        _addKey(calls, 2, meera, address(will));
        calls[4] = _call(address(will), abi.encodeCall(FamilyWill.makeWill, (_heirs(), _shares(), _usdcOnly(), SILENCE, WINDOW)));
        _ownerBatch(priya, calls);
        vm.warp(block.timestamp + SILENCE);
        will.openClaim(priya);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(arjun);
        vm.expectRevert(FamilyWill.NotAnAllowanceWill.selector);
        will.take(priya, USDC, 1);
    }
}
