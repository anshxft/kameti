// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockPQPrecompile {
    mapping(bytes32 => bool) private _registered;

    function register(bytes calldata vk, bytes calldata message, bytes calldata sig) external {
        _registered[keccak256(abi.encode(vk, message, sig))] = true;
    }

    function verifySlhDsaSha2128s(bytes calldata vk, bytes calldata message, bytes calldata sig)
        external
        view
        returns (bool)
    {
        return _registered[keccak256(abi.encode(vk, message, sig))];
    }
}
