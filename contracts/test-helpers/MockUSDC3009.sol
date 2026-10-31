// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockERC20} from "./MockERC20.sol";

/// @dev Minimal EIP-3009 USDC mock for Kameti v3 tests.
///      Implements receiveWithAuthorization + cancelAuthorization + authorizationState
///      with a real EIP-712 domain (name="USDC", version="2").
contract MockUSDC3009 is MockERC20 {

    // ─── EIP-712 ────────────────────────────────────────────────────────────────

    bytes32 private constant _RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 private constant _CANCEL_TYPEHASH = keccak256(
        "CancelAuthorization(address authorizer,bytes32 nonce)"
    );

    bytes32 public immutable DOMAIN_SEPARATOR;

    // authorizer => nonce => used/cancelled
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    // ─── Errors ────────────────────────────────────────────────────────────────
    error AuthorizationAlreadyUsed();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error CallerMustBePayee();
    error InvalidSignature();

    constructor() MockERC20("USD Coin", "USDC", 6) {
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("USDC")),
            keccak256(bytes("2")),
            block.chainid,
            address(this)
        ));
    }

    // ─── EIP-3009: receiveWithAuthorization ────────────────────────────────────

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (msg.sender != to) revert CallerMustBePayee();
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationStates[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(
            _RECEIVE_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != from) revert InvalidSignature();

        _authorizationStates[from][nonce] = true;

        // perform transfer
        require(balanceOf[from] >= value, "insufficient");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    // ─── EIP-3009: cancelAuthorization ─────────────────────────────────────────

    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(abi.encode(
            _CANCEL_TYPEHASH,
            authorizer,
            nonce
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != authorizer) revert InvalidSignature();

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    // ─── EIP-3009: authorizationState ──────────────────────────────────────────

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    // ─── Events ────────────────────────────────────────────────────────────────
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
}
