// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Mock no formato AggregatorV3Interface do Chainlink, pra testar sem depender de rede real.
contract MockOracle {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public decimals;

    constructor(int256 answer_, uint8 decimals_) {
        answer = answer_;
        decimals = decimals_;
        updatedAt = block.timestamp;
    }

    function setAnswer(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        updatedAt = updatedAt_;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer_, uint256 startedAt, uint256 updatedAt_, uint80 answeredInRound)
    {
        return (0, answer, 0, updatedAt, 0);
    }
}
