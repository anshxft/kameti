// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IKametiScore
/// @notice Public score interface for Kameti circles. Other Arc contracts can read
///         on-chain creditworthiness scores without importing the full Kameti contract.
///         Scores range from 300 (poor) to 900 (excellent), defaulting to 600 for new addresses.
interface IKametiScore {
    /// @notice The score stats struct returned by statsOf.
    struct ScoreStats {
        uint32 onTimePayments;
        uint32 strikes;
        uint32 defaults;
        uint32 circlesCompleted;
        uint256 totalContributed;
    }

    /// @notice Returns the Kameti Score for an address (300–900).
    /// @param who Address to query.
    /// @return score Current Kameti Score.
    function scoreOf(address who) external view returns (uint16 score);

    /// @notice Returns full score statistics for an address.
    /// @param who Address to query.
    /// @return stats ScoreStats breakdown.
    function statsOf(address who) external view returns (ScoreStats memory stats);

    /// @notice Returns true if the address meets the minimum score requirement.
    /// @param who Address to query.
    /// @param minScore Minimum required score.
    /// @return True if scoreOf(who) >= minScore.
    function isReliable(address who, uint16 minScore) external view returns (bool);
}
