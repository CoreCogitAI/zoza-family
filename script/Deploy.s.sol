// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {FamilySavings} from "../src/FamilySavings.sol";
import {FamilyWatcher} from "../src/FamilyWatcher.sol";
import {FamilyWill} from "../src/FamilyWill.sol";
import {IComet} from "../src/interfaces/IComet.sol";

/// Deploys FamilyWill, FamilySavings and FamilyWatcher.
///   COMET      the Compound III market whose base token plans save in
///   FORWARDER  Chainlink's (Mock)KeystoneForwarder allowed to send reports
contract Deploy is Script {
    // forge sends CREATE2 deployments through this factory.
    address constant FACTORY = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint160 constant FLAGS_MASK = 0x1F;
    uint160 constant BEFORE_EXECUTE = 0x08;

    function run() external {
        IComet comet = IComet(vm.envAddress("COMET"));
        address forwarder = vm.envAddress("FORWARDER");

        // Calibur reads a hook's permissions from the low bits of its address.
        bytes32 initHash = keccak256(type(FamilyWill).creationCode);
        bytes32 salt;
        address predicted;
        for (uint256 i;; i++) {
            salt = keccak256(abi.encode("zoza.family.will", i));
            predicted = vm.computeCreate2Address(salt, initHash, FACTORY);
            if (uint160(predicted) & FLAGS_MASK == BEFORE_EXECUTE && predicted.code.length == 0) break;
        }

        vm.startBroadcast();
        FamilyWill will = new FamilyWill{salt: salt}();
        FamilySavings savings = new FamilySavings(comet);
        FamilyWatcher watcher = new FamilyWatcher(forwarder, will, savings);
        vm.stopBroadcast();
        require(address(will) == predicted, "will address");

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "block", block.number);
        vm.serializeAddress(o, "will", address(will));
        vm.serializeAddress(o, "savings", address(savings));
        vm.serializeAddress(o, "watcher", address(watcher));
        vm.serializeAddress(o, "forwarder", forwarder);
        vm.serializeAddress(o, "comet", address(comet));
        string memory json = vm.serializeAddress(o, "usdc", address(savings.token()));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("will", address(will));
        console.log("savings", address(savings));
        console.log("watcher", address(watcher));
    }
}
