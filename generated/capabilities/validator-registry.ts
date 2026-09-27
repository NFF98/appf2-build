// Generated from the canonical Capability Registry. Do not edit.
export const VALIDATOR_REGISTRY = {
  "capabilities": [
    {
      "actions": [],
      "bindings": [
        "disabled"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "press"
      ],
      "id": "action.button",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "USER_GESTURE",
      "propsSchema": {
        "ref": "capability://action.button/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://action.button/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "title",
        "description",
        "children"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "content.card",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://content.card/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://content.card/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "items",
        "item_template"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "content.list",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://content.list/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://content.list/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "text"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "content.text",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://content.text/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://content.text/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "value"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "data.stat",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://data.stat/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://data.stat/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "rows"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "data.table_basic",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://data.table_basic/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://data.table_basic/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "bind"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "change"
      ],
      "id": "input.number",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://input.number/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://input.number/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "bind"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "change"
      ],
      "id": "input.select",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://input.select/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://input.select/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "bind"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "change"
      ],
      "id": "input.text",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://input.text/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://input.text/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "bind"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "change"
      ],
      "id": "input.toggle",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://input.toggle/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://input.toggle/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "children"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "layout.container",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://layout.container/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://layout.container/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [
        "sample_number",
        "choose_item"
      ],
      "bindings": [],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "logic.random",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://logic.random/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://logic.random/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [
        "increment",
        "set",
        "reset"
      ],
      "bindings": [],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "change"
      ],
      "id": "logic.score",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://logic.score/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://logic.score/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [
        "start",
        "pause",
        "resume",
        "reset"
      ],
      "bindings": [],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [
        "complete"
      ],
      "id": "logic.timer",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://logic.timer/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://logic.timer/1.0.0/state"
      },
      "version": "1.0.0"
    },
    {
      "actions": [],
      "bindings": [
        "action_refs"
      ],
      "compatibility": {
        "blueprintSchemaRange": ">=1.0.0 <2.0.0",
        "dependencies": [],
        "maxRuntimeVersion": "<2.0.0",
        "minRuntimeVersion": "1.0.0"
      },
      "degradation": {
        "allowed": false,
        "alternatives": [],
        "preservesSemanticCore": true
      },
      "events": [],
      "id": "system.notice",
      "inputs": [],
      "operators": [],
      "outputs": [],
      "permissionClass": "NONE",
      "propsSchema": {
        "ref": "capability://system.notice/1.0.0/props"
      },
      "resourceBudget": {
        "maxActionBindings": 100,
        "maxConcurrentTimers": 10,
        "maxEventBindings": 200,
        "maxInstancesPerBlueprint": 100,
        "maxLocalStateBytes": 131072,
        "maxSerializedPropsBytes": 262144,
        "mediaAutoplayAllowed": false,
        "networkAccessAllowed": false
      },
      "stateSchema": {
        "ref": "capability://system.notice/1.0.0/state"
      },
      "version": "1.0.0"
    }
  ],
  "registryDigest": "567c227d8f0726a7a3bfa50b357ce933d48ab5aaa629b25bfcac3cab4fb6bafa",
  "registryVersion": "1.0.0"
} as const;
