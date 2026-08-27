// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// Registro de agentes autorizados a operar no Settlement.
/// O "owner" de um agente é quem o cadastrou (dono/operador do bot),
/// não necessariamente quem assina os trades.
contract Registry is Ownable {
    struct Agent {
        address owner;
        string metadataURI;
        bool active;
        uint64 registeredAt;
        uint64 successfulFills;
    }

    mapping(address => Agent) public agents;
    address public settlement;
    bool public globalPause;

    event AgentRegistered(address indexed agent, address indexed owner, string metadataURI);
    event AgentPaused(address indexed agent);
    event AgentUnpaused(address indexed agent);
    event GlobalPauseSet(bool paused);
    event SettlementSet(address indexed settlement);

    modifier onlyAgentOwner(address agent) {
        require(agents[agent].owner == msg.sender, "Registry: not agent owner");
        _;
    }

    modifier onlySettlement() {
        require(msg.sender == settlement, "Registry: not settlement");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setSettlement(address _settlement) external onlyOwner {
        require(_settlement != address(0), "Registry: zero settlement");
        settlement = _settlement;
        emit SettlementSet(_settlement);
    }

    // msg.sender é o próprio endereço do agente (prova que controla a chave);
    // ownerAddress é quem administra pausa/metadados, pode ser outra conta (ex: cofre do operador)
    function registerAgent(address ownerAddress, string calldata metadataURI) external {
        address agent = msg.sender;
        require(ownerAddress != address(0), "Registry: zero owner");
        require(agents[agent].owner == address(0), "Registry: already registered");
        agents[agent] = Agent({
            owner: ownerAddress,
            metadataURI: metadataURI,
            active: true,
            registeredAt: uint64(block.timestamp),
            successfulFills: 0
        });
        emit AgentRegistered(agent, ownerAddress, metadataURI);
    }

    function pauseAgent(address agent) external onlyAgentOwner(agent) {
        agents[agent].active = false;
        emit AgentPaused(agent);
    }

    function unpauseAgent(address agent) external onlyAgentOwner(agent) {
        agents[agent].active = true;
        emit AgentUnpaused(agent);
    }

    function setGlobalPause(bool paused) external onlyOwner {
        globalPause = paused;
        emit GlobalPauseSet(paused);
    }

    function isActive(address agent) external view returns (bool) {
        return agents[agent].owner != address(0) && agents[agent].active && !globalPause;
    }

    function recordFill(address agent) external onlySettlement {
        agents[agent].successfulFills += 1;
    }
}
