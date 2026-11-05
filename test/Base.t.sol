// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {
    BatchedCall,
    Call,
    CaliburKeys,
    ICalibur,
    Key,
    KeyType,
    SignedBatchedCall
} from "../src/interfaces/ICalibur.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// Runs against Ethereum Sepolia as deployed: Uniswap's Calibur, Compound III
/// and Circle's test USDC. Nothing here is a mock.
abstract contract Base is Test {
    address constant CALIBUR = 0x000000005c84F8Fd50b21CAC312528A64437030e;
    address constant AAVE_FAUCET = 0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; // Circle's test USDC
    address constant COMET = 0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e; // Compound III USDC market
    uint256 constant FORK_BLOCK = 12_069_700;

    uint256 constant PRIYA_PK = uint256(keccak256("zoza.family.test.priya"));
    uint256 constant ARJUN_PK = uint256(keccak256("zoza.family.test.arjun"));
    uint256 constant MEERA_PK = uint256(keccak256("zoza.family.test.meera"));
    uint256 constant RAVI_PK = uint256(keccak256("zoza.family.test.ravi"));
    uint256 constant DADA_PK = uint256(keccak256("zoza.family.test.dada"));
    address priya = vm.addr(PRIYA_PK); // the parent
    address arjun = vm.addr(ARJUN_PK); // son, heir
    address meera = vm.addr(MEERA_PK); // daughter, heir and child of the plan
    address ravi = vm.addr(RAVI_PK); // uncle, nominee
    address dada = vm.addr(DADA_PK); // grandfather, gives gifts
    address relayer = makeAddr("relayer");
    address stranger = makeAddr("stranger");

    IERC20 usdc = IERC20(USDC);

    bytes32 constant CALL_TYPEHASH = keccak256("Call(address to,uint256 value,bytes data)");
    bytes32 constant BATCHED_CALL_TYPEHASH =
        keccak256("BatchedCall(Call[] calls,bool revertOnFailure)Call(address to,uint256 value,bytes data)");
    bytes32 constant SIGNED_BATCHED_CALL_TYPEHASH = keccak256(
        "SignedBatchedCall(BatchedCall batchedCall,uint256 nonce,bytes32 keyHash,address executor,uint256 deadline)BatchedCall(Call[] calls,bool revertOnFailure)Call(address to,uint256 value,bytes data)"
    );

    function _fork() internal {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string("https://ethereum-sepolia-rpc.publicnode.com"));
        vm.createSelectFork(rpc, FORK_BLOCK);
    }

    /// The low five bits of a Calibur hook address are its permissions.
    function _hookAddress(string memory label, uint160 flags) internal pure returns (address) {
        return address((uint160(uint256(keccak256(bytes(label)))) & ~uint160(0x1F)) | flags);
    }

    /// EIP-7702: point the EOA at Calibur.
    function _delegate(uint256 pk) internal {
        address who = vm.addr(pk);
        vm.signAndAttachDelegation(CALIBUR, pk);
        vm.prank(who);
        ICalibur(who).execute(BatchedCall(new Call[](0), true));
        assertEq(who.code, abi.encodePacked(hex"ef0100", CALIBUR));
    }

    function _mintUsdc(address to, uint256 amount) internal {
        deal(USDC, to, usdc.balanceOf(to) + amount);
    }

    /// The wallet's own key sends a batch to itself (Calibur's root key).
    function _ownerBatch(address account, Call[] memory calls) internal {
        vm.prank(account);
        ICalibur(account).execute(BatchedCall(calls, true));
    }

    function _call(address to, bytes memory data) internal pure returns (Call memory) {
        return Call(to, 0, data);
    }

    function _one(Call memory c) internal pure returns (Call[] memory calls) {
        calls = new Call[](1);
        calls[0] = c;
    }

    /// Register `signer` as a non-admin key on the account with `hook`.
    function _addKey(Call[] memory calls, uint256 at, address signer, address hook) internal pure {
        bytes32 keyHash = CaliburKeys.hashOf(signer);
        calls[at] = _call(address(0), abi.encodeCall(ICalibur.register, (Key(KeyType.Secp256k1, abi.encode(signer)))));
        calls[at + 1] = _call(address(0), abi.encodeCall(ICalibur.update, (keyHash, uint256(uint160(hook)))));
    }

    /// A batch signed by `signerPk` (the owner, or a key on the account),
    /// sent by the relayer, who pays the gas.
    function _relay(address account, uint256 signerPk, bool asOwner, Call[] memory calls) internal {
        (SignedBatchedCall memory s, bytes memory sig) = _signBatch(account, signerPk, asOwner, calls);
        vm.prank(relayer);
        ICalibur(account).execute(s, sig);
    }

    function _signBatch(address account, uint256 signerPk, bool asOwner, Call[] memory calls)
        internal
        view
        returns (SignedBatchedCall memory s, bytes memory wrapped)
    {
        bytes32 keyHash = asOwner ? bytes32(0) : CaliburKeys.hashOf(vm.addr(signerPk));
        uint256 nonce = ICalibur(account).getSeq(0); // sequence key 0
        s = SignedBatchedCall(BatchedCall(calls, true), nonce, keyHash, address(0), 0);
        bytes32 digest = ICalibur(account).hashTypedData(_hash(s));
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(signerPk, digest);
        wrapped = abi.encode(abi.encodePacked(r, ss, v), bytes(""));
    }

    function _hash(SignedBatchedCall memory s) internal pure returns (bytes32) {
        bytes32[] memory hs = new bytes32[](s.batchedCall.calls.length);
        for (uint256 i; i < hs.length; i++) {
            Call memory c = s.batchedCall.calls[i];
            hs[i] = keccak256(abi.encode(CALL_TYPEHASH, c.to, c.value, keccak256(c.data)));
        }
        bytes32 batch =
            keccak256(abi.encode(BATCHED_CALL_TYPEHASH, keccak256(abi.encodePacked(hs)), s.batchedCall.revertOnFailure));
        return keccak256(abi.encode(SIGNED_BATCHED_CALL_TYPEHASH, batch, s.nonce, s.keyHash, s.executor, s.deadline));
    }

    /// An heir key spending from the owner's wallet, sent by the heir.
    function _asKey(address account, address signer, Call memory c) internal {
        vm.prank(signer);
        ICalibur(account).execute(BatchedCall(_one(c), true));
    }
}
