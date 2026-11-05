// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// The parts of Uniswap's Calibur v1.1.0 (github.com/Uniswap/calibur) we use.

struct Call {
    address to;
    uint256 value;
    bytes data;
}

struct BatchedCall {
    Call[] calls;
    bool revertOnFailure;
}

struct SignedBatchedCall {
    BatchedCall batchedCall;
    uint256 nonce;
    bytes32 keyHash;
    address executor; // address(0): anyone may send it
    uint256 deadline; // 0: never expires
}

enum KeyType {
    P256,
    WebAuthnP256,
    Secp256k1
}

struct Key {
    KeyType keyType;
    bytes publicKey; // Secp256k1: abi.encode(address)
}

interface ICalibur {
    function execute(BatchedCall calldata batchedCall) external payable;
    function execute(SignedBatchedCall calldata signedBatchedCall, bytes calldata wrappedSignature) external payable;
    function register(Key calldata key) external;
    function update(bytes32 keyHash, uint256 settings) external;
    function revoke(bytes32 keyHash) external;
    function isRegistered(bytes32 keyHash) external view returns (bool);
    function getKeySettings(bytes32 keyHash) external view returns (uint256);
    function getSeq(uint256 key) external view returns (uint256);
    function hashTypedData(bytes32 structHash) external view returns (bytes32);
}

/// Calibur calls this before every call made by a key whose hook address has
/// the BEFORE_EXECUTE flag (bit 3) set. Reverting blocks the call.
interface IExecutionHook {
    function beforeExecute(bytes32 keyHash, address to, uint256 value, bytes calldata data)
        external
        returns (bytes4, bytes memory);

    function afterExecute(bytes32 keyHash, bool success, bytes calldata output, bytes calldata beforeExecuteData)
        external
        returns (bytes4);
}

library CaliburKeys {
    /// Calibur's key hash for an Ethereum address key.
    function hashOf(address signer) internal pure returns (bytes32) {
        return keccak256(abi.encode(KeyType.Secp256k1, keccak256(abi.encode(signer))));
    }

    /// Settings word: bit 200 admin, bits 160-199 expiry, low 160 bits hook.
    function hookOf(uint256 settings) internal pure returns (address) {
        return address(uint160(settings));
    }

    function isAdmin(uint256 settings) internal pure returns (bool) {
        return (settings >> 200) & 1 == 1;
    }

    function expiry(uint256 settings) internal pure returns (uint40) {
        return uint40(settings >> 160);
    }
}
