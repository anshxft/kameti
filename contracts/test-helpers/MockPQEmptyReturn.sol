// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockPQEmptyReturn {
    fallback() external {
        assembly {
            return(0, 0)
        }
    }
}
