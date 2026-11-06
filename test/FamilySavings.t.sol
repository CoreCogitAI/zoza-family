// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base} from "./Base.t.sol";
import {FamilySavings} from "../src/FamilySavings.sol";
import {Call} from "../src/interfaces/ICalibur.sol";
import {IComet} from "../src/interfaces/IComet.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

contract FamilySavingsTest is Base {
    FamilySavings savings;
    uint128 constant MONTHLY = 25e6; // 25 USDC
    uint32 constant MONTH = 30 days;

    function setUp() public {
        _fork();
        savings = new FamilySavings(IComet(COMET));
        _delegate(PRIYA_PK);
        _mintUsdc(priya, 1_000e6);
        _mintUsdc(dada, 500e6);
    }

    /// Priya signs one batch: the mandate (allowance) and the plan.
    function _open(bool earn, uint64 maturity) internal returns (uint256 id) {
        id = savings.planCount();
        Call[] memory calls = new Call[](2);
        calls[0] = _call(USDC, abi.encodeCall(IERC20.approve, (address(savings), uint256(MONTHLY) * 12)));
        calls[1] = _call(
            address(savings),
            abi.encodeCall(FamilySavings.createPlan, ("Meera's studies", meera, ravi, MONTHLY, MONTH, maturity, earn))
        );
        _relay(priya, PRIYA_PK, true, calls);
    }

    function _year() internal view returns (uint64) {
        return uint64(block.timestamp + 365 days);
    }

    // ------------------------------------------------------------ the mandate

    function test_firstInstalmentIsDueAtOnce() public {
        uint256 id = _open(false, _year());
        vm.prank(stranger); // anyone may trigger it
        assertTrue(savings.collect(id));
        assertEq(savings.valueOf(id), MONTHLY);
        assertEq(usdc.balanceOf(priya), 1_000e6 - MONTHLY);
    }

    function test_onePullPerPeriod_whoeverCalls() public {
        uint256 id = _open(false, _year());
        savings.collect(id);
        vm.expectRevert();
        savings.collect(id);
        vm.warp(block.timestamp + MONTH - 1);
        vm.expectRevert();
        savings.collect(id);
        vm.warp(block.timestamp + 1);
        savings.collect(id);
        assertEq(savings.planOf(id).paidCount, 2);
    }

    function test_keeperAbsentForMonths_stillOnlyOnePull() public {
        uint256 id = _open(false, _year());
        vm.warp(block.timestamp + 5 * MONTH);
        savings.collect(id);
        vm.expectRevert();
        savings.collect(id);
        assertEq(savings.valueOf(id), MONTHLY);
    }

    function test_emptyWallet_isMissedNotReverted() public {
        uint256 id = _open(false, _year());
        _ownerBatch(priya, _one(_call(USDC, abi.encodeCall(IERC20.transfer, (stranger, 1_000e6)))));
        assertFalse(savings.collect(id));
        FamilySavings.Plan memory p = savings.planOf(id);
        assertEq(p.missedCount, 1);
        assertEq(p.paidCount, 0);
        // Next month it tries again, and the plan goes on.
        _mintUsdc(priya, MONTHLY);
        vm.warp(block.timestamp + MONTH);
        assertTrue(savings.collect(id));
    }

    function test_mandateCappedByAllowance() public {
        uint256 id = _open(false, _year());
        for (uint256 i; i < 12; i++) {
            assertTrue(savings.collect(id));
            vm.warp(block.timestamp + MONTH);
        }
        // Twelve approved, so the thirteenth pull is missed.
        assertFalse(savings.collect(id));
    }

    function test_pausedMandate_cannotBePulled() public {
        uint256 id = _open(false, _year());
        _ownerBatch(priya, _one(_call(address(savings), abi.encodeCall(FamilySavings.setMandate, (id, false)))));
        assertFalse(savings.canCollect(id));
        vm.expectRevert(FamilySavings.MandatePaused.selector);
        savings.collect(id);
    }

    function test_onlyParentPausesMandate() public {
        uint256 id = _open(false, _year());
        vm.prank(ravi);
        vm.expectRevert(FamilySavings.NotParent.selector);
        savings.setMandate(id, false);
    }

    // ------------------------------------------------------------ gifts and top-ups

    function test_grandfatherGift() public {
        uint256 id = _open(false, _year());
        vm.startPrank(dada);
        usdc.approve(address(savings), 100e6);
        savings.deposit(id, 100e6);
        vm.stopPrank();
        assertEq(savings.valueOf(id), 100e6);
        assertEq(savings.planOf(id).paidIn, 100e6);
    }

    // ------------------------------------------------------------ maturity

    function test_lockedUntilMaturity_thenAllToTheChild() public {
        uint64 maturity = _year();
        uint256 id = _open(false, maturity);
        savings.collect(id);
        vm.startPrank(dada);
        usdc.approve(address(savings), 100e6);
        savings.deposit(id, 100e6);
        vm.stopPrank();

        vm.expectRevert();
        savings.release(id);

        vm.warp(maturity);
        vm.prank(stranger);
        savings.release(id);
        assertEq(usdc.balanceOf(meera), 125e6);
        assertEq(savings.valueOf(id), 0);
        vm.expectRevert(FamilySavings.Closed.selector);
        savings.release(id);
    }

    function test_noPullsOrGiftsAfterMaturity() public {
        uint64 maturity = _year();
        uint256 id = _open(false, maturity);
        vm.warp(maturity);
        vm.expectRevert(FamilySavings.PastMaturity.selector);
        savings.collect(id);
    }

    // ------------------------------------------------------------ nominee

    function test_nomineeCanPointToChildsNewWallet() public {
        uint64 maturity = _year();
        uint256 id = _open(false, maturity);
        savings.collect(id);
        address newWallet = makeAddr("meera-new-phone");
        vm.prank(ravi);
        savings.setChild(id, newWallet);
        vm.warp(maturity);
        savings.release(id);
        assertEq(usdc.balanceOf(newWallet), MONTHLY);
    }

    function test_strangerCannotChangeChild() public {
        uint256 id = _open(false, _year());
        vm.prank(stranger);
        vm.expectRevert(FamilySavings.NotParentOrNominee.selector);
        savings.setChild(id, stranger);
    }

    function test_closeEarly_needsNominee() public {
        uint256 id = _open(false, _year());
        savings.collect(id);
        vm.prank(priya);
        vm.expectRevert(FamilySavings.NomineeMustAgree.selector);
        savings.closeEarly(id);

        vm.prank(stranger);
        vm.expectRevert(FamilySavings.NotNominee.selector);
        savings.agreeToClose(id);

        vm.prank(ravi);
        savings.agreeToClose(id);
        uint256 before = usdc.balanceOf(priya);
        vm.prank(priya);
        savings.closeEarly(id);
        assertEq(usdc.balanceOf(priya), before + MONTHLY);
    }

    // ------------------------------------------------------------ changing a plan

    function test_changeNominee_dropsAgreementAndWaitsAPeriod() public {
        uint256 id = _open(false, _year());
        savings.collect(id);
        vm.prank(ravi);
        savings.agreeToClose(id);

        address aunt = makeAddr("aunt");
        vm.prank(priya);
        savings.setNominee(id, aunt);
        assertEq(savings.planOf(id).nominee, aunt);
        assertFalse(savings.planOf(id).nomineeAgreesToClose); // Ravi's agreement is gone

        vm.prank(ravi); // the old nominee has no say now
        vm.expectRevert(FamilySavings.NotNominee.selector);
        savings.agreeToClose(id);

        vm.prank(aunt);
        savings.agreeToClose(id);
        vm.prank(priya);
        vm.expectRevert(abi.encodeWithSelector(FamilySavings.NomineeTooNew.selector, uint64(block.timestamp + MONTH)));
        savings.closeEarly(id);

        vm.warp(block.timestamp + MONTH);
        vm.prank(priya);
        savings.closeEarly(id);
        assertTrue(savings.planOf(id).closed);
        (,, uint256[] memory asNominee) = savings.plansOf(aunt);
        assertEq(asNominee.length, 1);
    }

    function test_onlyParentChangesNominee() public {
        uint256 id = _open(false, _year());
        vm.prank(ravi);
        vm.expectRevert(FamilySavings.NotParent.selector);
        savings.setNominee(id, ravi);
        vm.startPrank(priya);
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.setNominee(id, priya); // the parent cannot be the nominee
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.setNominee(id, address(0));
        vm.stopPrank();
    }

    function test_extendMaturity_onlyLater() public {
        uint64 maturity = _year();
        uint256 id = _open(false, maturity);
        savings.collect(id);
        vm.startPrank(priya);
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.extendMaturity(id, maturity - 1);
        savings.extendMaturity(id, maturity + 365 days);
        vm.stopPrank();
        vm.prank(ravi);
        vm.expectRevert(FamilySavings.NotParent.selector);
        savings.extendMaturity(id, maturity + 400 days);

        vm.warp(maturity);
        vm.expectRevert(abi.encodeWithSelector(FamilySavings.NotMature.selector, maturity + 365 days));
        savings.release(id);
        vm.warp(maturity + 365 days);
        savings.release(id);
        assertEq(usdc.balanceOf(meera), MONTHLY);
    }

    function test_changeAmount_fromTheNextInstalment() public {
        uint256 id = _open(false, _year());
        savings.collect(id);
        vm.prank(priya);
        savings.setInstalment(id, 10e6);
        vm.warp(block.timestamp + MONTH);
        savings.collect(id);
        assertEq(savings.valueOf(id), MONTHLY + 10e6);
        vm.prank(priya);
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.setInstalment(id, 0);
    }

    function test_payChildEarly_needsNominee() public {
        uint256 id = _open(true, _year());
        savings.collect(id);
        vm.prank(priya);
        vm.expectRevert(FamilySavings.NomineeMustAgree.selector);
        savings.payChildEarly(id);
        vm.prank(ravi);
        savings.agreeToClose(id);
        vm.prank(stranger);
        vm.expectRevert(FamilySavings.NotParent.selector);
        savings.payChildEarly(id);
        vm.prank(priya);
        savings.payChildEarly(id);
        assertApproxEqAbs(usdc.balanceOf(meera), MONTHLY, 10);
        assertTrue(savings.planOf(id).closed);
    }

    function test_badPlansRefused() public {
        vm.startPrank(priya);
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.createPlan("x", meera, priya, MONTHLY, MONTH, _year(), false); // nominee is the parent
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.createPlan("x", meera, ravi, MONTHLY, MONTH, uint64(block.timestamp), false); // already mature
        vm.expectRevert(FamilySavings.BadPlan.selector);
        savings.createPlan("x", address(0), ravi, MONTHLY, MONTH, _year(), false);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ interest (Compound)

    function test_earnPlan_growsWithCompoundInterest() public {
        uint64 maturity = _year();
        uint256 id = _open(true, maturity);
        savings.collect(id);
        assertApproxEqAbs(savings.valueOf(id), MONTHLY, 1);

        vm.warp(maturity);
        uint256 value = savings.valueOf(id);
        assertGt(value, MONTHLY, "earned interest");
        savings.release(id);
        assertApproxEqAbs(usdc.balanceOf(meera), value, 1);
    }

    function test_earnPlans_shareInterestFairly() public {
        uint64 maturity = _year();
        uint256 a = _open(true, maturity);
        savings.collect(a);
        vm.warp(block.timestamp + 180 days);
        // A second family joins halfway: it must not take the first one's interest.
        vm.startPrank(dada);
        uint256 b = savings.createPlan("Grandson", stranger, ravi, MONTHLY, MONTH, maturity, true);
        usdc.approve(address(savings), MONTHLY);
        savings.collect(b);
        vm.stopPrank();
        uint256 aAtJoin = savings.valueOf(a);
        assertApproxEqAbs(savings.valueOf(b), MONTHLY, 1);
        vm.warp(maturity);
        assertGt(savings.valueOf(a), aAtJoin);
        assertGt(savings.valueOf(a) - MONTHLY, savings.valueOf(b) - MONTHLY, "earlier saver earned more");
    }

    function test_donationCannotStealFromTheFirstSaver() public {
        uint256 id = _open(true, _year());
        // An attacker supplies USDC to Compound for the contract before anyone saves.
        address attacker = makeAddr("attacker");
        _mintUsdc(attacker, 1_000e6);
        vm.startPrank(attacker);
        usdc.approve(COMET, 1_000e6);
        IComet(COMET).supplyTo(address(savings), USDC, 1_000e6);
        vm.stopPrank();
        savings.collect(id);
        // The first saver's plan still holds what they paid in (or more).
        assertGe(savings.valueOf(id) + 1, MONTHLY);
    }

    function test_safeAndEarnPlansDoNotMix() public {
        uint64 maturity = _year();
        uint256 safe = _open(false, maturity);
        uint256 earn = _open(true, maturity);
        savings.collect(safe);
        savings.collect(earn);
        vm.warp(maturity);
        assertEq(savings.valueOf(safe), MONTHLY);
        assertGt(savings.valueOf(earn), MONTHLY);
        savings.release(safe);
        savings.release(earn);
    }
}


contract FamilySavingsViewsTest is Base {
    FamilySavings savings;

    function setUp() public {
        _fork();
        savings = new FamilySavings(IComet(COMET));
        _mintUsdc(priya, 100e6);
    }

    function test_passbookAndPlansOf() public {
        vm.startPrank(priya);
        usdc.approve(address(savings), 10e6);
        uint256 id = savings.createPlan("Meera", meera, ravi, 10e6, 1 days, uint64(block.timestamp + 30 days), false);
        savings.collect(id);
        vm.warp(block.timestamp + 1 days);
        savings.collect(id); // allowance used up: missed
        vm.stopPrank();

        FamilySavings.Entry[] memory e = savings.passbookOf(id);
        assertEq(e.length, 2);
        assertEq(uint8(e[0].kind), uint8(FamilySavings.Kind.Instalment));
        assertEq(uint8(e[1].kind), uint8(FamilySavings.Kind.Missed));

        (uint256[] memory asParent,,) = savings.plansOf(priya);
        assertEq(asParent.length, 1);
        (, uint256[] memory asChild,) = savings.plansOf(meera);
        assertEq(asChild.length, 1);
        (,, uint256[] memory asNominee) = savings.plansOf(ravi);
        assertEq(asNominee.length, 1);

        address newWallet = makeAddr("new");
        vm.prank(ravi);
        savings.setChild(id, newWallet);
        (, asChild,) = savings.plansOf(meera);
        assertEq(asChild.length, 0);
        (, asChild,) = savings.plansOf(newWallet);
        assertEq(asChild.length, 1);
    }
}
