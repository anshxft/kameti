// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockPQRevert {
    function verifySlhDsaSha2128s(bytes calldata, bytes calldata, bytes calldata) external pure {
        revert("pq revert");
    }
}
