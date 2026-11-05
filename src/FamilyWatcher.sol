// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FamilySavings} from "./FamilySavings.sol";
import {FamilyWill} from "./FamilyWill.sol";

/// Chainlink CRE's report receiver. The forwarder checks ERC-165 for this id,
/// which is the onReport selector alone (IReceiver extends IERC165).
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// Carries out Chainlink CRE reports: collect, openClaim and release.
/// Each action is permissionless and checked by its own contract, so a wrong
/// report cannot break a rule; a failing item is skipped.
contract FamilyWatcher is IReceiver {
    bytes4 private constant ERC165_ID = 0x01ffc9a7;

    address public immutable forwarder;
    FamilyWill public immutable will;
    FamilySavings public immutable savings;

    event Report(uint256 collected, uint256 claimsOpened, uint256 released, uint256 skipped);

    error NotForwarder();

    constructor(address forwarder_, FamilyWill will_, FamilySavings savings_) {
        forwarder = forwarder_;
        will = will_;
        savings = savings_;
    }

    /// `report` is abi.encode(uint256[] collect, address[] openClaim, uint256[] release).
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        (uint256[] memory collectIds, address[] memory owners, uint256[] memory releaseIds) =
            abi.decode(report, (uint256[], address[], uint256[]));

        uint256 collected;
        uint256 opened;
        uint256 released;
        uint256 skipped;
        for (uint256 i; i < collectIds.length; i++) {
            try savings.collect(collectIds[i]) returns (bool paid) {
                if (paid) collected++;
                else skipped++;
            } catch {
                skipped++;
            }
        }
        for (uint256 i; i < owners.length; i++) {
            try will.openClaim(owners[i]) {
                opened++;
            } catch {
                skipped++;
            }
        }
        for (uint256 i; i < releaseIds.length; i++) {
            try savings.release(releaseIds[i]) {
                released++;
            } catch {
                skipped++;
            }
        }
        emit Report(collected, opened, released, skipped);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == ERC165_ID;
    }
}
