// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {FamilyWill} from "../src/FamilyWill.sol";
import {BatchedCall, Call, CaliburKeys, ICalibur} from "../src/interfaces/ICalibur.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract FamilyWillTest is Base {
    FamilyWill will;
    uint32 constant SILENCE = 30 days;
    uint32 constant WINDOW = 7 days;

    function setUp() public {
        _fork();
        will = FamilyWill(_hookAddress("zoza.family.will", 0x08)); // BEFORE_EXECUTE only
        deployCodeTo("FamilyWill.sol:FamilyWill", address(will));
        _delegate(PRIYA_PK);
        _mintUsdc(priya, 1_000e6);
        vm.deal(priya, 1 ether);
    }

    // Priya: Arjun 60%, Meera 40%, of USDC and ETH.
    function _makeWill() internal {
        Call[] memory calls = new Call[](5);
        _addKey(calls, 0, arjun, address(will));
        _addKey(calls, 2, meera, address(will));
        calls[4] = _call(address(will), abi.encodeCall(FamilyWill.makeWill, (_heirs(), _shares(), _tokens(), SILENCE, WINDOW)));
        _ownerBatch(priya, calls);
    }

    function _heirs() internal view returns (address[] memory a) {
        a = new address[](2);
        (a[0], a[1]) = (arjun, meera);
    }

    function _shares() internal pure returns (uint16[] memory s) {
        s = new uint16[](2);
        (s[0], s[1]) = (6_000, 4_000);
    }

    function _tokens() internal pure returns (address[] memory t) {
        t = new address[](2);
        (t[0], t[1]) = (USDC, address(0));
    }

    function _pay(address heir, address to, uint256 amount) internal returns (Call memory) {
        heir;
        return _call(USDC, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function _release() internal {
        vm.warp(block.timestamp + SILENCE);
        vm.prank(stranger);
        will.openClaim(priya);
        vm.warp(block.timestamp + WINDOW);
    }

    // ------------------------------------------------------------ setup

    function test_makeWill_recordsHeirsAndStartsAlive() public {
        _makeWill();
        FamilyWill.Will memory w = will.willOf(priya);
        assertEq(w.heirs.length, 2);
        assertEq(w.shares[0], 6_000);
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.Alive));
        // Money stays in Priya's wallet.
        assertEq(usdc.balanceOf(priya), 1_000e6);
    }

    function test_makeWill_refusesHeirKeyWithoutTheHook() public {
        Call[] memory calls = new Call[](5);
        _addKey(calls, 0, arjun, address(0)); // a key with no hook could move anything
        _addKey(calls, 2, meera, address(will));
        calls[4] = _call(address(will), abi.encodeCall(FamilyWill.makeWill, (_heirs(), _shares(), _tokens(), SILENCE, WINDOW)));
        vm.prank(priya);
        vm.expectRevert(); // Calibur wraps the hook's HeirKeyNotGuarded
        ICalibur(priya).execute(_batch(calls));
    }

    function test_makeWill_refusesSharesNotSummingToAll() public {
        uint16[] memory s = new uint16[](2);
        (s[0], s[1]) = (6_000, 3_000);
        Call[] memory calls = new Call[](5);
        _addKey(calls, 0, arjun, address(will));
        _addKey(calls, 2, meera, address(will));
        calls[4] = _call(address(will), abi.encodeCall(FamilyWill.makeWill, (_heirs(), s, _tokens(), SILENCE, WINDOW)));
        vm.prank(priya);
        vm.expectRevert();
        ICalibur(priya).execute(_batch(calls));
    }

    function test_makeWill_byRelayer_ownerPaysNoGas() public {
        Call[] memory calls = new Call[](5);
        _addKey(calls, 0, arjun, address(will));
        _addKey(calls, 2, meera, address(will));
        calls[4] = _call(address(will), abi.encodeCall(FamilyWill.makeWill, (_heirs(), _shares(), _tokens(), SILENCE, WINDOW)));
        uint256 ethBefore = priya.balance;
        _relay(priya, PRIYA_PK, true, calls);
        assertEq(priya.balance, ethBefore);
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.Alive));
    }

    // ------------------------------------------------------------ while alive

    function test_heirCannotSpendWhileOwnerIsAlive() public {
        _makeWill();
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 1e6));
        assertEq(usdc.balanceOf(priya), 1_000e6);
    }

    function test_claimCannotOpenBeforeSilence() public {
        _makeWill();
        vm.warp(block.timestamp + SILENCE - 1);
        vm.expectRevert();
        will.openClaim(priya);
    }

    function test_heirCannotSpendDuringTheCancelWindow() public {
        _makeWill();
        vm.warp(block.timestamp + SILENCE);
        will.openClaim(priya);
        vm.warp(block.timestamp + WINDOW - 1);
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 1e6));
    }

    function test_ownerCheckInCancelsTheClaim() public {
        _makeWill();
        vm.warp(block.timestamp + SILENCE);
        will.openClaim(priya);
        _ownerBatch(priya, _one(_call(address(will), abi.encodeCall(FamilyWill.checkIn, ()))));
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.Alive));
        vm.warp(block.timestamp + WINDOW);
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 1e6));
        // The silence clock restarted at the check-in.
        vm.expectRevert();
        will.openClaim(priya);
    }

    function test_checkInByRelayer() public {
        _makeWill();
        vm.warp(block.timestamp + 10 days);
        _relay(priya, PRIYA_PK, true, _one(_call(address(will), abi.encodeCall(FamilyWill.checkIn, ()))));
        assertEq(will.willOf(priya).lastSeen, block.timestamp);
    }

    // ------------------------------------------------------------ release

    function test_afterRelease_eachHeirTakesExactlyTheirShare() public {
        _makeWill();
        _release();
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.Released));
        assertEq(will.claimable(priya, arjun, USDC), 600e6);

        _asKey(priya, arjun, _pay(arjun, arjun, 600e6));
        _asKey(priya, meera, _pay(meera, meera, 400e6));
        assertEq(usdc.balanceOf(arjun), 600e6);
        assertEq(usdc.balanceOf(meera), 400e6);
        assertEq(usdc.balanceOf(priya), 0);
    }

    function test_heirCannotTakeMoreThanShare() public {
        _makeWill();
        _release();
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 600e6 + 1));
        // In parts is fine, up to the share.
        _asKey(priya, arjun, _pay(arjun, arjun, 100e6));
        _asKey(priya, arjun, _pay(arjun, arjun, 500e6));
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 1));
    }

    function test_shareIsOfTheBalanceAtFirstPayout_notWhatIsLeft() public {
        _makeWill();
        _release();
        _asKey(priya, arjun, _pay(arjun, arjun, 600e6));
        // Meera's 40% is still of 1,000, not of the 400 left.
        assertEq(will.claimable(priya, meera, USDC), 400e6);
    }

    function test_heirCannotPaySomeoneElse() public {
        _makeWill();
        _release();
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, stranger, 1e6));
    }

    function test_heirCannotUseAnUnlistedToken() public {
        _makeWill();
        address link = 0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5;
        IAaveFaucetLike(AAVE_FAUCET).mint(link, priya, 1e18);
        _release();
        vm.expectRevert();
        _asKey(priya, arjun, _call(link, abi.encodeCall(IERC20.transfer, (arjun, 1e18))));
    }

    function test_heirCannotCallAnythingButTransfer() public {
        _makeWill();
        _release();
        vm.expectRevert();
        _asKey(priya, arjun, _call(USDC, abi.encodeCall(IERC20.approve, (arjun, type(uint256).max))));
        vm.expectRevert();
        _asKey(priya, arjun, _call(address(will), abi.encodeCall(FamilyWill.checkIn, ())));
    }

    function test_heirKeyCannotChangeTheWallet() public {
        _makeWill();
        _release();
        // Calibur itself refuses self-calls from non-admin keys.
        vm.expectRevert();
        _asKey(priya, arjun, _call(address(0), abi.encodeCall(ICalibur.revoke, (CaliburKeys.hashOf(meera)))));
    }

    function test_ethShare() public {
        _makeWill();
        _release();
        vm.prank(arjun);
        Call[] memory c = new Call[](1);
        c[0] = Call(arjun, 0.6 ether, "");
        ICalibur(priya).execute(_batch(c));
        assertEq(arjun.balance, 0.6 ether);
        vm.prank(arjun);
        c[0] = Call(arjun, 1, "");
        vm.expectRevert();
        ICalibur(priya).execute(_batch(c));
    }

    function test_heirClaimsWithoutGas_relayed() public {
        _makeWill();
        _release();
        _relay(priya, ARJUN_PK, false, _one(_pay(arjun, arjun, 600e6)));
        assertEq(usdc.balanceOf(arjun), 600e6);
    }

    function test_strangerKeyIsNotAnHeir() public {
        _makeWill();
        _release();
        vm.expectRevert(); // not registered on the wallet at all
        _asKey(priya, stranger, _pay(stranger, stranger, 1));
    }

    // ------------------------------------------------------------ revoke and remake

    function test_revokeWill_heirKeysStopEvenIfStillRegistered() public {
        _makeWill();
        _ownerBatch(priya, _one(_call(address(will), abi.encodeCall(FamilyWill.revokeWill, ()))));
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.None));
        assertTrue(ICalibur(priya).isRegistered(CaliburKeys.hashOf(arjun)));
        vm.warp(block.timestamp + SILENCE + WINDOW);
        vm.expectRevert();
        will.openClaim(priya);
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 1));
    }

    function test_newWillReplacesOld() public {
        _makeWill();
        // New will: everything to Meera. Arjun's key is still registered.
        address[] memory h = new address[](1);
        h[0] = meera;
        uint16[] memory s = new uint16[](1);
        s[0] = 10_000;
        _ownerBatch(priya, _one(_call(address(will), abi.encodeCall(FamilyWill.makeWill, (h, s, _tokens(), SILENCE, WINDOW)))));
        _release();
        vm.expectRevert();
        _asKey(priya, arjun, _pay(arjun, arjun, 1));
        _asKey(priya, meera, _pay(meera, meera, 1_000e6));
        assertEq(usdc.balanceOf(meera), 1_000e6);
    }

    function test_ownerCanStillSpendFreely() public {
        _makeWill();
        _ownerBatch(priya, _one(_pay(priya, stranger, 250e6)));
        assertEq(usdc.balanceOf(stranger), 250e6);
        _release();
        assertEq(will.claimable(priya, arjun, USDC), 450e6); // 60% of 750
    }

    function test_willsNaming() public {
        _makeWill();
        address[] memory o = will.willsNaming(arjun);
        assertEq(o.length, 1);
        assertEq(o[0], priya);
        _ownerBatch(priya, _one(_call(address(will), abi.encodeCall(FamilyWill.revokeWill, ()))));
        assertEq(will.willsNaming(arjun).length, 0);
    }

    function _batch(Call[] memory calls) internal pure returns (BatchedCall memory) {
        return BatchedCall(calls, true);
    }
}

interface IAaveFaucetLike {
    function mint(address token, address to, uint256 amount) external returns (uint256);
}
