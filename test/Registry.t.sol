// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/Registry.sol";

contract RegistryTest is Test {
    Registry registry;

    address owner = address(this);
    address agentOwner = makeAddr("agentOwner");
    address agent = makeAddr("agent");
    address settlementAddr = makeAddr("settlement");

    function setUp() public {
        registry = new Registry();
    }

    function test_RegisterAgent_Success() public {
        vm.prank(agent);
        registry.registerAgent(agentOwner, "ipfs://agent-metadata");

        assertTrue(registry.isActive(agent));
        (address ownerOf,,, bool active,) = _agentFields(agent);
        assertEq(ownerOf, agentOwner);
        assertTrue(active);
    }

    function test_RegisterAgent_AgentIsAlwaysTheCaller() public {
        // msg.sender vira o agente; não é possível registrar um endereço que você não controla
        vm.prank(agent);
        vm.expectEmit(true, true, false, true);
        emit Registry.AgentRegistered(agent, agentOwner, "meta");
        registry.registerAgent(agentOwner, "meta");
    }

    function test_RegisterAgent_RevertsIfAlreadyRegistered() public {
        vm.prank(agent);
        registry.registerAgent(agentOwner, "meta");

        vm.prank(agent);
        vm.expectRevert("Registry: already registered");
        registry.registerAgent(agentOwner, "meta");
    }

    function test_RegisterAgent_RevertsOnZeroOwner() public {
        vm.prank(agent);
        vm.expectRevert("Registry: zero owner");
        registry.registerAgent(address(0), "meta");
    }

    function test_PauseAgent_OnlyOwnerOfAgent() public {
        vm.prank(agent);
        registry.registerAgent(agentOwner, "meta");

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert("Registry: not agent owner");
        registry.pauseAgent(agent);

        vm.prank(agentOwner);
        registry.pauseAgent(agent);
        assertFalse(registry.isActive(agent));
    }

    function test_UnpauseAgent() public {
        vm.prank(agent);
        registry.registerAgent(agentOwner, "meta");

        vm.prank(agentOwner);
        registry.pauseAgent(agent);
        assertFalse(registry.isActive(agent));

        vm.prank(agentOwner);
        registry.unpauseAgent(agent);
        assertTrue(registry.isActive(agent));
    }

    function test_GlobalPause_BlocksEvenActiveAgent() public {
        vm.prank(agent);
        registry.registerAgent(agentOwner, "meta");
        assertTrue(registry.isActive(agent));

        registry.setGlobalPause(true); // owner = address(this)
        assertFalse(registry.isActive(agent));

        registry.setGlobalPause(false);
        assertTrue(registry.isActive(agent));
    }

    function test_GlobalPause_OnlyOwner() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        registry.setGlobalPause(true);
    }

    function test_UnregisteredAgent_IsNotActive() public {
        assertFalse(registry.isActive(agent));
    }

    function test_RecordFill_OnlySettlement() public {
        vm.prank(agent);
        registry.registerAgent(agentOwner, "meta");

        registry.setSettlement(settlementAddr);

        vm.prank(makeAddr("randomCaller"));
        vm.expectRevert("Registry: not settlement");
        registry.recordFill(agent);

        vm.prank(settlementAddr);
        registry.recordFill(agent);

        (,,,, uint64 fills) = _agentFields(agent);
        assertEq(fills, 1);
    }

    function test_SetSettlement_OnlyOwner() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert();
        registry.setSettlement(settlementAddr);
    }

    function _agentFields(address a)
        internal
        view
        returns (address ownerOf, string memory meta, uint64 registeredAt, bool active, uint64 fills)
    {
        (ownerOf, meta, active, registeredAt, fills) = registry.agents(a);
    }
}
