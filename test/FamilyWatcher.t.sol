// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {FamilySavings} from "../src/FamilySavings.sol";
import {FamilyWatcher, IReceiver} from "../src/FamilyWatcher.sol";
import {FamilyWill} from "../src/FamilyWill.sol";
import {Call} from "../src/interfaces/ICalibur.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract FamilyWatcherTest is Base {
    // Chainlink's MockKeystoneForwarder on Sepolia, used by `cre workflow simulate`.
    address constant MOCK_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;
    FamilyWill will;
    FamilySavings savings;
    FamilyWatcher watcher;

    function setUp() public {
        _fork();
        will = FamilyWill(_hookAddress("zoza.family.will", 0x08));
        deployCodeTo("FamilyWill.sol:FamilyWill", address(will));
        savings = new FamilySavings(IComet(COMET));
        watcher = new FamilyWatcher(MOCK_FORWARDER, will, savings);
        _delegate(PRIYA_PK);
        _mintUsdc(priya, 1_000e6);
    }

    function _plan(uint64 maturity) internal returns (uint256 id) {
        id = savings.planCount();
        Call[] memory calls = new Call[](2);
        calls[0] = _call(USDC, abi.encodeCall(IERC20.approve, (address(savings), 100e6)));
        calls[1] = _call(address(savings), abi.encodeCall(FamilySavings.createPlan, ("Meera", meera, ravi, 10e6, 1 days, maturity, false)));
        _ownerBatch(priya, calls);
    }

    function _will() internal {
        address[] memory h = new address[](1);
        h[0] = meera;
        uint16[] memory s = new uint16[](1);
        s[0] = 10_000;
        address[] memory t = new address[](1);
        t[0] = USDC;
        Call[] memory calls = new Call[](3);
        _addKey(calls, 0, meera, address(will));
        calls[2] = _call(address(will), abi.encodeCall(FamilyWill.makeWill, (h, s, t, 2 days, 1 days)));
        _ownerBatch(priya, calls);
    }

    function _report(uint256[] memory c, address[] memory o, uint256[] memory r) internal {
        vm.prank(MOCK_FORWARDER);
        watcher.onReport("", abi.encode(c, o, r));
    }

    function test_supportsTheCreReceiverInterface() public view {
        assertTrue(watcher.supportsInterface(IReceiver.onReport.selector));
        assertTrue(watcher.supportsInterface(0x01ffc9a7));
        assertFalse(watcher.supportsInterface(0xffffffff));
    }

    function test_onlyTheForwarder() public {
        vm.expectRevert(FamilyWatcher.NotForwarder.selector);
        watcher.onReport("", abi.encode(new uint256[](0), new address[](0), new uint256[](0)));
    }

    function test_oneReportCollectsOpensAndReleases() public {
        uint256 maturing = _plan(uint64(block.timestamp + 3 days));
        _will();
        uint256 monthly = _plan(uint64(block.timestamp + 30 days));
        vm.warp(block.timestamp + 3 days);

        uint256[] memory c = new uint256[](1);
        c[0] = monthly;
        address[] memory o = new address[](1);
        o[0] = priya;
        uint256[] memory r = new uint256[](1);
        r[0] = maturing;
        _report(c, o, r);

        assertEq(savings.valueOf(monthly), 10e6);
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.Claim));
        assertTrue(savings.planOf(maturing).closed);
    }

    function test_wrongReportCannotBreakRules() public {
        uint256 id = _plan(uint64(block.timestamp + 30 days));
        _will();
        savings.collect(id);
        // Collect again too early, open a claim on someone alive, release early.
        uint256[] memory c = new uint256[](1);
        c[0] = id;
        address[] memory o = new address[](1);
        o[0] = priya;
        _report(c, o, c);
        assertEq(savings.valueOf(id), 10e6);
        assertEq(uint8(will.stateOf(priya)), uint8(FamilyWill.State.Alive));
        assertFalse(savings.planOf(id).closed);
    }
}
