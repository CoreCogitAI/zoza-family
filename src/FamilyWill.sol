// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {CaliburKeys, ICalibur, IExecutionHook} from "./interfaces/ICalibur.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// A will for a wallet, in one of two forms.
/// - Inside a Calibur (EIP-7702) wallet: each heir is a non-admin key guarded
///   by this hook, and it can only send its own heir that heir's share.
/// - For any other wallet (MetaMask, a hardware wallet): the owner gives this
///   contract an ERC-20 allowance, and each heir pulls their share with `take`.
/// Either way nothing can move until the owner is silent for `silence` and
/// nobody cancels within `window`, and each heir gets only their own share.
/// Deploy at an address whose low five bits are 01000 (BEFORE_EXECUTE only).
contract FamilyWill is IExecutionHook {
    uint16 public constant ALL = 10_000; // shares are in basis points
    uint256 public constant MAX_HEIRS = 8;
    uint256 public constant MAX_TOKENS = 8;
    address public constant ETH = address(0);

    struct Will {
        uint64 version; // bumped by every new or revoked will
        uint64 lastSeen;
        uint64 claimOpenedAt; // 0 while no claim is open
        uint32 silence;
        uint32 window;
        address[] heirs;
        uint16[] shares;
        address[] tokens;
        bool pull; // heirs pull through an allowance instead of using Calibur keys
    }

    enum State {
        None, // no will
        Alive, // checked in recently
        Silent, // silent long enough: anyone may open a claim
        Claim, // claim open: the owner can still cancel by checking in
        Released // heirs may take their shares
    }

    mapping(address owner => Will) private _wills;
    mapping(address heir => address[] owners) private _namedBy; // every will that ever named them
    // All per-version, so a new will never inherits an old one's keys or payouts.
    mapping(address owner => mapping(uint64 version => mapping(bytes32 keyHash => uint256 slot))) private _heirSlot;
    mapping(address owner => mapping(uint64 version => mapping(address token => uint256))) private _base;
    mapping(address owner => mapping(uint64 version => mapping(address token => mapping(address heir => uint256))))
        private _paid;
    mapping(address owner => mapping(uint64 version => mapping(address token => uint256))) private _totalPaid;

    event WillMade(
        address indexed owner,
        uint64 version,
        address[] heirs,
        uint16[] shares,
        address[] tokens,
        uint32 silence,
        uint32 window
    );
    event WillRevoked(address indexed owner, uint64 version);
    event CheckedIn(address indexed owner, uint64 at);
    event ClaimOpened(address indexed owner, address indexed by, uint64 releaseAt);
    event ClaimCancelled(address indexed owner);
    event SharePaid(address indexed owner, address indexed heir, address indexed token, uint256 amount);

    error NoWill();
    error BadWill();
    error HeirKeyNotGuarded(address heir);
    error NotSilentYet(uint64 openableAt);
    error ClaimAlreadyOpen();
    error NotReleased(uint64 releaseAt);
    error NotAnHeirKey();
    error OnlyTransfers();
    error NotYourAddress();
    error TokenNotInWill();
    error MoreThanShare(uint256 left);
    error NotAnAllowanceWill();
    error TransferFailed();

    // ------------------------------------------------------------ owner

    /// Called by the owner's wallet after registering one key per heir with this hook.
    function makeWill(
        address[] calldata heirs,
        uint16[] calldata shares,
        address[] calldata tokens,
        uint32 silence,
        uint32 window
    ) external {
        _make(heirs, shares, tokens, silence, window, false);
    }

    /// For a wallet without Calibur. The owner also approves this contract for
    /// each token; heirs take their shares with `take` after release. ERC-20 only.
    function makeWillWithAllowance(
        address[] calldata heirs,
        uint16[] calldata shares,
        address[] calldata tokens,
        uint32 silence,
        uint32 window
    ) external {
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == ETH) revert BadWill(); // ETH cannot be pulled
        }
        _make(heirs, shares, tokens, silence, window, true);
    }

    function _make(
        address[] calldata heirs,
        uint16[] calldata shares,
        address[] calldata tokens,
        uint32 silence,
        uint32 window,
        bool pull
    ) private {
        uint256 n = heirs.length;
        if (n == 0 || n > MAX_HEIRS || shares.length != n) revert BadWill();
        if (tokens.length == 0 || tokens.length > MAX_TOKENS) revert BadWill();
        if (silence == 0 || window == 0) revert BadWill();

        Will storage w = _wills[msg.sender];
        uint64 v = w.version + 1;
        w.version = v;

        uint256 sum;
        for (uint256 i; i < n; i++) {
            address heir = heirs[i];
            if (heir == address(0) || heir == msg.sender || shares[i] == 0) revert BadWill();
            bytes32 keyHash = CaliburKeys.hashOf(heir);
            if (_heirSlot[msg.sender][v][keyHash] != 0) revert BadWill(); // listed twice
            if (!pull) {
                // An heir key without this hook could move anything at any time.
                uint256 settings = ICalibur(msg.sender).getKeySettings(keyHash);
                if (
                    !ICalibur(msg.sender).isRegistered(keyHash) || CaliburKeys.hookOf(settings) != address(this)
                        || CaliburKeys.isAdmin(settings)
                ) revert HeirKeyNotGuarded(heir);
            }
            _heirSlot[msg.sender][v][keyHash] = i + 1;
            _namedBy[heir].push(msg.sender);
            sum += shares[i];
        }
        if (sum != ALL) revert BadWill();
        for (uint256 i; i < tokens.length; i++) {
            for (uint256 j; j < i; j++) {
                if (tokens[i] == tokens[j]) revert BadWill();
            }
        }

        w.heirs = heirs;
        w.shares = shares;
        w.tokens = tokens;
        w.silence = silence;
        w.window = window;
        w.pull = pull;
        w.lastSeen = uint64(block.timestamp);
        w.claimOpenedAt = 0;
        emit WillMade(msg.sender, v, heirs, shares, tokens, silence, window);
    }

    /// Ends the will. Heir keys stop working at once.
    function revokeWill() external {
        Will storage w = _wills[msg.sender];
        if (w.heirs.length == 0) revert NoWill();
        uint64 v = w.version + 1;
        delete _wills[msg.sender];
        _wills[msg.sender].version = v;
        emit WillRevoked(msg.sender, v);
    }

    /// "I'm here." Also cancels an open claim.
    function checkIn() external {
        Will storage w = _wills[msg.sender];
        if (w.heirs.length == 0) revert NoWill();
        w.lastSeen = uint64(block.timestamp);
        if (w.claimOpenedAt != 0) {
            w.claimOpenedAt = 0;
            emit ClaimCancelled(msg.sender);
        }
        emit CheckedIn(msg.sender, uint64(block.timestamp));
    }

    // ------------------------------------------------------------ anyone

    /// Anyone may open the cancel window once the owner has been silent long enough.
    function openClaim(address owner) external {
        Will storage w = _wills[owner];
        if (w.heirs.length == 0) revert NoWill();
        if (w.claimOpenedAt != 0) revert ClaimAlreadyOpen();
        uint64 openable = w.lastSeen + w.silence;
        if (block.timestamp < openable) revert NotSilentYet(openable);
        w.claimOpenedAt = uint64(block.timestamp);
        emit ClaimOpened(owner, msg.sender, uint64(block.timestamp) + w.window);
    }

    // ------------------------------------------------------------ the hook

    /// Calibur calls this before every heir-key call. After release, the only
    /// call allowed pays this heir up to their share of a listed token.
    function beforeExecute(bytes32 keyHash, address to, uint256 value, bytes calldata data)
        external
        returns (bytes4, bytes memory)
    {
        address owner = msg.sender;
        Will storage w = _wills[owner];
        uint256 slot = _heirSlot[owner][w.version][keyHash];
        if (slot == 0 || w.heirs.length == 0) revert NotAnHeirKey();
        uint64 releaseAt = w.claimOpenedAt + w.window;
        if (w.claimOpenedAt == 0 || block.timestamp < releaseAt) revert NotReleased(releaseAt);

        address heir = w.heirs[slot - 1];
        address token;
        address recipient;
        uint256 amount;
        if (data.length == 0) {
            (token, recipient, amount) = (ETH, to, value);
        } else {
            if (value != 0 || data.length != 68 || bytes4(data[:4]) != IERC20.transfer.selector) revert OnlyTransfers();
            (recipient, amount) = abi.decode(data[4:], (address, uint256));
            token = to;
        }
        if (recipient != heir) revert NotYourAddress();
        _charge(owner, w, slot, heir, token, amount);
        return (IExecutionHook.beforeExecute.selector, "");
    }

    // ------------------------------------------------------------ heirs, allowance wills

    /// After release, an heir of an allowance will takes up to their share of
    /// `token`, straight from the owner's wallet to their own.
    function take(address owner, address token, uint256 amount) external {
        Will storage w = _wills[owner];
        if (!w.pull) revert NotAnAllowanceWill();
        uint256 slot = _heirSlot[owner][w.version][CaliburKeys.hashOf(msg.sender)];
        if (slot == 0 || w.heirs.length == 0) revert NotAnHeirKey();
        uint64 releaseAt = w.claimOpenedAt + w.window;
        if (w.claimOpenedAt == 0 || block.timestamp < releaseAt) revert NotReleased(releaseAt);
        _charge(owner, w, slot, msg.sender, token, amount);
        if (!IERC20(token).transferFrom(owner, msg.sender, amount)) revert TransferFailed();
    }

    /// Books a payout against the heir's share. Shares are of what the will
    /// could pay at the first payout of each token.
    function _charge(address owner, Will storage w, uint256 slot, address heir, address token, uint256 amount) private {
        if (!_listed(w, token)) revert TokenNotInWill();
        uint64 v = w.version;
        uint256 base = _base[owner][v][token];
        if (base == 0) {
            base = _available(owner, w, token) + _totalPaid[owner][v][token];
            _base[owner][v][token] = base;
        }
        uint256 due = base * w.shares[slot - 1] / ALL;
        uint256 paid = _paid[owner][v][token][heir];
        if (amount > due - paid) revert MoreThanShare(due - paid);
        _paid[owner][v][token][heir] = paid + amount;
        _totalPaid[owner][v][token] += amount;
        emit SharePaid(owner, heir, token, amount);
    }

    /// Not used: the hook address does not set AFTER_EXECUTE.
    function afterExecute(bytes32, bool, bytes calldata, bytes calldata) external pure returns (bytes4) {
        revert OnlyTransfers();
    }

    // ------------------------------------------------------------ views

    function willOf(address owner) external view returns (Will memory) {
        return _wills[owner];
    }

    /// Owners whose current will names `heir`.
    function willsNaming(address heir) external view returns (address[] memory owners) {
        address[] storage all = _namedBy[heir];
        owners = new address[](all.length);
        uint256 n;
        bytes32 keyHash = CaliburKeys.hashOf(heir);
        for (uint256 i; i < all.length; i++) {
            address o = all[i];
            bool seen;
            for (uint256 j; j < n; j++) {
                if (owners[j] == o) seen = true;
            }
            if (!seen && _heirSlot[o][_wills[o].version][keyHash] != 0 && _wills[o].heirs.length != 0) owners[n++] = o;
        }
        assembly ("memory-safe") {
            mstore(owners, n)
        }
    }

    function stateOf(address owner) public view returns (State) {
        Will storage w = _wills[owner];
        if (w.heirs.length == 0) return State.None;
        if (w.claimOpenedAt != 0) {
            return block.timestamp >= w.claimOpenedAt + w.window ? State.Released : State.Claim;
        }
        return block.timestamp >= w.lastSeen + w.silence ? State.Silent : State.Alive;
    }

    /// When the claim can open (Alive), or when shares unlock (Claim).
    function nextMoment(address owner) external view returns (State state, uint64 at) {
        Will storage w = _wills[owner];
        state = stateOf(owner);
        if (state == State.Alive || state == State.Silent) at = w.lastSeen + w.silence;
        else if (state == State.Claim || state == State.Released) at = w.claimOpenedAt + w.window;
    }

    /// What `heir` can take of `token` right now (0 before release).
    function claimable(address owner, address heir, address token) external view returns (uint256) {
        Will storage w = _wills[owner];
        if (stateOf(owner) != State.Released || !_listed(w, token)) return 0;
        uint256 slot = _heirSlot[owner][w.version][CaliburKeys.hashOf(heir)];
        if (slot == 0) return 0;
        uint64 v = w.version;
        uint256 base = _base[owner][v][token];
        if (base == 0) base = _available(owner, w, token) + _totalPaid[owner][v][token];
        return base * w.shares[slot - 1] / ALL - _paid[owner][v][token][heir];
    }

    function paidTo(address owner, address heir, address token) external view returns (uint256) {
        return _paid[owner][_wills[owner].version][token][heir];
    }

    // ------------------------------------------------------------ internal

    function _listed(Will storage w, address token) private view returns (bool) {
        for (uint256 i; i < w.tokens.length; i++) {
            if (w.tokens[i] == token) return true;
        }
        return false;
    }

    /// What the will can pay out of `token`: the balance, and for an
    /// allowance will no more than the allowance left.
    function _available(address owner, Will storage w, address token) private view returns (uint256) {
        if (token == ETH) return owner.balance;
        uint256 bal = IERC20(token).balanceOf(owner);
        if (!w.pull) return bal;
        uint256 allowed = IERC20(token).allowance(owner, address(this));
        return allowed < bal ? allowed : bal;
    }
}
