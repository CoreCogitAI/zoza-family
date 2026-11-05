// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IComet} from "./interfaces/IComet.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// Monthly savings plans for a child, paid from the parent's own wallet.
/// The parent approves once; anyone may call `collect`, which pulls at most one
/// instalment per period and records a miss instead of failing.
/// Money is locked until maturity, then goes to the child, optionally earning
/// Compound III's supply rate. The nominee can move the plan to the child's
/// new wallet and must agree to an early close.
contract FamilySavings {
    enum Kind {
        Instalment,
        TopUp,
        Gift,
        Missed
    }

    /// One line of the plan's passbook.
    struct Entry {
        uint64 at;
        Kind kind;
        address from;
        uint128 amount;
    }

    struct Plan {
        address parent;
        address child;
        address nominee;
        uint128 instalment;
        uint32 period;
        bool earn; // supplied to Compound
        bool mandateOn;
        bool closed;
        bool nomineeAgreesToClose;
        uint64 nextDue;
        uint64 maturity;
        uint64 createdAt;
        uint32 paidCount;
        uint32 missedCount;
        uint256 units; // token amount, or shares of the Compound balance when `earn`
        uint256 paidIn; // everything paid in, for the passbook
        string name;
    }

    // A virtual offset keeps the first saver's shares safe from a donation.
    uint256 private constant VIRTUAL_SHARES = 1e6;
    uint256 private constant VIRTUAL_ASSETS = 1;

    IERC20 public immutable token;
    IComet public immutable market;

    Plan[] private _plans;
    mapping(uint256 id => Entry[]) private _passbook;
    mapping(address person => uint256[] ids) private _linked; // parent, child or nominee, ever
    uint256 public totalShares;
    uint256 private _locked = 1;

    event PlanCreated(
        uint256 indexed id,
        address indexed parent,
        address indexed child,
        address nominee,
        uint128 instalment,
        uint32 period,
        uint64 maturity,
        bool earn,
        string name
    );
    event Deposited(uint256 indexed id, address indexed from, Kind kind, uint256 amount, uint256 units);
    event Missed(uint256 indexed id, uint32 missedCount);
    event MandateChanged(uint256 indexed id, bool on);
    event ChildChanged(uint256 indexed id, address child, address by);
    event NomineeAgreedToClose(uint256 indexed id);
    event Matured(uint256 indexed id, address indexed child, uint256 amount);
    event ClosedEarly(uint256 indexed id, address indexed parent, uint256 amount);

    error BadPlan();
    error NoPlan();
    error NotParent();
    error NotParentOrNominee();
    error NotNominee();
    error NotDue(uint64 nextDue);
    error Closed();
    error NotMature(uint64 maturity);
    error PastMaturity();
    error NomineeMustAgree();
    error MandatePaused();
    error TransferFailed();
    error Reentered();

    modifier nonReentrant() {
        if (_locked != 1) revert Reentered();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(IComet market_) {
        market = market_;
        token = IERC20(market_.baseToken());
        token.approve(address(market_), type(uint256).max);
    }

    // ------------------------------------------------------------ parent

    function createPlan(
        string calldata name,
        address child,
        address nominee,
        uint128 instalment,
        uint32 period,
        uint64 maturity,
        bool earn
    ) external returns (uint256 id) {
        if (child == address(0) || nominee == address(0) || nominee == msg.sender) revert BadPlan();
        if (instalment == 0 || period == 0 || maturity <= block.timestamp) revert BadPlan();
        if (bytes(name).length == 0 || bytes(name).length > 64) revert BadPlan();
        id = _plans.length;
        Plan storage p = _plans.push();
        p.parent = msg.sender;
        p.child = child;
        p.nominee = nominee;
        p.instalment = instalment;
        p.period = period;
        p.earn = earn;
        p.mandateOn = true;
        p.nextDue = uint64(block.timestamp); // the first instalment is due now
        p.maturity = maturity;
        p.createdAt = uint64(block.timestamp);
        p.name = name;
        _linked[msg.sender].push(id);
        _linked[child].push(id);
        _linked[nominee].push(id);
        emit PlanCreated(id, msg.sender, child, nominee, instalment, period, maturity, earn, name);
    }

    /// Pause or resume the monthly pull.
    function setMandate(uint256 id, bool on) external {
        Plan storage p = _plan(id);
        if (msg.sender != p.parent) revert NotParent();
        p.mandateOn = on;
        emit MandateChanged(id, on);
    }

    /// Close before maturity, after the nominee agrees. Money goes back to the parent.
    function closeEarly(uint256 id) external nonReentrant {
        Plan storage p = _plan(id);
        if (msg.sender != p.parent) revert NotParent();
        if (p.closed) revert Closed();
        if (!p.nomineeAgreesToClose) revert NomineeMustAgree();
        uint256 amount = _payOut(p, p.parent);
        emit ClosedEarly(id, p.parent, amount);
    }

    // ------------------------------------------------------------ nominee

    /// Point the plan to the child's new wallet.
    function setChild(uint256 id, address child) external {
        Plan storage p = _plan(id);
        if (msg.sender != p.parent && msg.sender != p.nominee) revert NotParentOrNominee();
        if (child == address(0) || p.closed) revert BadPlan();
        p.child = child;
        _linked[child].push(id);
        emit ChildChanged(id, child, msg.sender);
    }

    function agreeToClose(uint256 id) external {
        Plan storage p = _plan(id);
        if (msg.sender != p.nominee) revert NotNominee();
        p.nomineeAgreesToClose = true;
        emit NomineeAgreedToClose(id);
    }

    // ------------------------------------------------------------ anyone

    /// Pull this period's instalment. Anyone may call it.
    function collect(uint256 id) external nonReentrant returns (bool paid) {
        Plan storage p = _plan(id);
        if (p.closed) revert Closed();
        if (block.timestamp >= p.maturity) revert PastMaturity();
        if (!p.mandateOn) revert MandatePaused();
        if (block.timestamp < p.nextDue) revert NotDue(p.nextDue);
        // One pull per period, even if nobody called for a while.
        p.nextDue = uint64(block.timestamp) + p.period;

        if (_tryPull(p.parent, p.instalment)) {
            p.paidCount++;
            _credit(id, p, p.parent, Kind.Instalment, p.instalment);
            return true;
        }
        p.missedCount++;
        _passbook[id].push(Entry(uint64(block.timestamp), Kind.Missed, p.parent, p.instalment));
        emit Missed(id, p.missedCount);
        return false;
    }

    /// Add money to a plan: the parent topping up, or family giving a gift.
    function deposit(uint256 id, uint256 amount) external nonReentrant {
        Plan storage p = _plan(id);
        if (p.closed) revert Closed();
        if (block.timestamp >= p.maturity) revert PastMaturity();
        if (amount == 0) revert BadPlan();
        if (!_tryPull(msg.sender, amount)) revert TransferFailed();
        _credit(id, p, msg.sender, msg.sender == p.parent ? Kind.TopUp : Kind.Gift, amount);
    }

    /// At maturity everything, interest included, goes to the child.
    function release(uint256 id) external nonReentrant {
        Plan storage p = _plan(id);
        if (p.closed) revert Closed();
        if (block.timestamp < p.maturity) revert NotMature(p.maturity);
        uint256 amount = _payOut(p, p.child);
        emit Matured(id, p.child, amount);
    }

    // ------------------------------------------------------------ views

    function planCount() external view returns (uint256) {
        return _plans.length;
    }

    function planOf(uint256 id) external view returns (Plan memory) {
        return _plan(id);
    }

    function passbookOf(uint256 id) external view returns (Entry[] memory) {
        _plan(id);
        return _passbook[id];
    }

    /// Plans where `who` is now the parent, the child or the nominee.
    function plansOf(address who)
        external
        view
        returns (uint256[] memory asParent, uint256[] memory asChild, uint256[] memory asNominee)
    {
        uint256[] storage ids = _linked[who];
        uint256 n = ids.length;
        (asParent, asChild, asNominee) = (new uint256[](n), new uint256[](n), new uint256[](n));
        (uint256 a, uint256 b, uint256 c) = (0, 0, 0);
        for (uint256 i; i < n; i++) {
            uint256 id = ids[i];
            Plan storage p = _plans[id];
            // An id can be linked twice (setChild back and forth); count it once.
            if (p.parent == who && !_has(asParent, a, id)) asParent[a++] = id;
            if (p.child == who && !_has(asChild, b, id)) asChild[b++] = id;
            if (p.nominee == who && !_has(asNominee, c, id)) asNominee[c++] = id;
        }
        assembly ("memory-safe") {
            mstore(asParent, a)
            mstore(asChild, b)
            mstore(asNominee, c)
        }
    }

    /// What the plan is worth now, in the token.
    function valueOf(uint256 id) public view returns (uint256) {
        Plan storage p = _plan(id);
        if (p.closed) return 0;
        return p.earn ? _toAssets(p.units) : p.units;
    }

    function canCollect(uint256 id) external view returns (bool) {
        Plan storage p = _plan(id);
        return !p.closed && p.mandateOn && block.timestamp < p.maturity && block.timestamp >= p.nextDue;
    }

    // ------------------------------------------------------------ internal

    function _has(uint256[] memory list, uint256 len, uint256 id) private pure returns (bool) {
        for (uint256 i; i < len; i++) {
            if (list[i] == id) return true;
        }
        return false;
    }

    function _plan(uint256 id) private view returns (Plan storage) {
        if (id >= _plans.length) revert NoPlan();
        return _plans[id];
    }

    function _credit(uint256 id, Plan storage p, address from, Kind kind, uint256 amount) private {
        uint256 units = amount;
        if (p.earn) {
            units = _toShares(amount);
            market.supply(address(token), amount);
            totalShares += units;
        }
        p.units += units;
        p.paidIn += amount;
        _passbook[id].push(Entry(uint64(block.timestamp), kind, from, uint128(amount)));
        emit Deposited(id, from, kind, amount, units);
    }

    function _payOut(Plan storage p, address to) private returns (uint256 amount) {
        p.closed = true;
        uint256 units = p.units;
        p.units = 0;
        if (p.earn) {
            amount = _toAssets(units);
            totalShares -= units;
            if (amount != 0) market.withdrawTo(to, address(token), amount);
        } else {
            amount = units;
            if (amount != 0 && !token.transfer(to, amount)) revert TransferFailed();
        }
    }

    function _toShares(uint256 assets) private view returns (uint256) {
        return assets * (totalShares + VIRTUAL_SHARES) / (market.balanceOf(address(this)) + VIRTUAL_ASSETS);
    }

    function _toAssets(uint256 shares) private view returns (uint256) {
        return shares * (market.balanceOf(address(this)) + VIRTUAL_ASSETS) / (totalShares + VIRTUAL_SHARES);
    }

    /// transferFrom that returns false instead of reverting.
    function _tryPull(address from, uint256 amount) private returns (bool) {
        (bool ok, bytes memory ret) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (from, address(this), amount)));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }
}
