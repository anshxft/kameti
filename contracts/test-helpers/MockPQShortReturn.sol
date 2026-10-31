// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockPQShortReturn {
    fallback() external {
        assembly {
            mstore(0, 1)
            return(0, 31)
        }
    }
}
