// Generated from the canonical Capability Registry. Do not edit.
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";

export const VALIDATOR_REGISTRY: ValidatorRegistry = {
  "capabilities": {
    "action.button": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:62950ed13ab6ab27c398efe494f1ee756a11dcf165419a7052c174c373251d44",
        "execution_status": "ACTIVE",
        "id": "action.button",
        "permission_class": "USER_GESTURE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "disabled": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "BOOLEAN"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": false,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "press": {
              "invariant_ids": [],
              "payload": {
                "descriptor": {
                  "constraints": {
                    "fields": {}
                  },
                  "type": "RECORD"
                },
                "kind": "STATIC"
              }
            }
          },
          "invariant_ids": [],
          "props": {
            "label": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "content.card": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:f362daa913e128f439a7d455811ba47d8fd5ec1c7b5640ae9b983e02e7048911",
        "execution_status": "ACTIVE",
        "id": "content.card",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "description": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 500
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": false,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            },
            "title": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": false,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": true,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [],
          "props": {}
        },
        "version": "1.0.0"
      }
    },
    "content.list": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:2b736f85a9ef5e75f665a84fd127c4b74005aa01400b9652a61f02764be5155e",
        "execution_status": "ACTIVE",
        "id": "content.list",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {},
          "capability_state": "NONE",
          "composition": {
            "children": true,
            "repeat": true,
            "repeat_required": true
          },
          "events": {},
          "invariant_ids": [],
          "props": {}
        },
        "version": "1.0.0"
      }
    },
    "content.text": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:0ad458afc3eab7883bb9210d427f3f3ff4bc515558731593f6d3096d0d8c91b0",
        "execution_status": "ACTIVE",
        "id": "content.text",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "text": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 8192
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [],
          "props": {
            "role": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "allowed": [
                      "BODY",
                      "LABEL",
                      "HEADING",
                      "CAPTION"
                    ]
                  },
                  "type": "ENUM"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "data.stat": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:d8a650b39677b7c7d13213194f3b870bae8243d0c72857410c3672442648cf8c",
        "execution_status": "ACTIVE",
        "id": "data.stat",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "value": {
              "invariant_ids": [],
              "matcher": {
                "kind": "ONE_OF",
                "options": [
                  {
                    "descriptor": {
                      "type": "NUMBER"
                    },
                    "kind": "EXACT"
                  },
                  {
                    "descriptor": {
                      "constraints": {
                        "max_length": 8192
                      },
                      "type": "STRING"
                    },
                    "kind": "EXACT"
                  },
                  {
                    "descriptor": {
                      "type": "BOOLEAN"
                    },
                    "kind": "EXACT"
                  },
                  {
                    "kind": "ANY_ENUM"
                  }
                ]
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [
            "STAT_FORMAT"
          ],
          "props": {
            "format": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "allowed": [
                      "NUMBER",
                      "TEXT",
                      "PERCENT",
                      "CURRENCY_DISPLAY"
                    ]
                  },
                  "type": "ENUM"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "label": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "data.table_basic": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:7cb39280c6b6dfdddb39c18f513af367c0b2e71254251f91e0fcbcfed2509436",
        "execution_status": "ACTIVE",
        "id": "data.table_basic",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "rows": {
              "invariant_ids": [],
              "matcher": {
                "item": {
                  "kind": "ANY_RECORD"
                },
                "kind": "LIST_OF",
                "max_length": 500
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [
            "TABLE_COLUMNS",
            "TABLE_ROWS_BOUND"
          ],
          "props": {
            "columns": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "item": {
                      "constraints": {
                        "fields": {
                          "format": {
                            "constraints": {
                              "allowed": [
                                "TEXT",
                                "NUMBER",
                                "PERCENT",
                                "CURRENCY_DISPLAY"
                              ]
                            },
                            "type": "ENUM"
                          },
                          "key": {
                            "constraints": {
                              "max_length": 64
                            },
                            "type": "STRING"
                          },
                          "label": {
                            "constraints": {
                              "max_length": 120
                            },
                            "type": "STRING"
                          }
                        }
                      },
                      "type": "RECORD"
                    },
                    "max_length": 500
                  },
                  "type": "LIST"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "max_rows": {
              "invariant_ids": [
                "NUM_INT_RANGE_0_500"
              ],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "input.number": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:48db9f29dbf62728ae5ec05de9e00ad11a3cdfe1fd0991e6302a63f3d2eac9b0",
        "execution_status": "ACTIVE",
        "id": "input.number",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "bind": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": true,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "STATE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "change": {
              "invariant_ids": [],
              "payload": {
                "descriptor": {
                  "constraints": {
                    "fields": {
                      "value": {
                        "type": "NUMBER"
                      }
                    }
                  },
                  "type": "RECORD"
                },
                "kind": "STATIC"
              }
            }
          },
          "invariant_ids": [
            "INPUT_NUMBER_BOUNDS"
          ],
          "props": {
            "label": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "max": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "min": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "required": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "BOOLEAN"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "step": {
              "invariant_ids": [
                "NUM_GT_ZERO"
              ],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "input.select": {
      "2.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:819f24fa80bca2b1a676260a7b05f03b25673ba7f446e1093446be47613db187",
        "execution_status": "ACTIVE",
        "id": "input.select",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "bind": {
              "invariant_ids": [],
              "matcher": {
                "kind": "ANY_ENUM"
              },
              "mutable_state_required": true,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "STATE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "change": {
              "invariant_ids": [],
              "payload": {
                "binding_key": "bind",
                "kind": "BOUND_STATE_DESCRIPTOR"
              }
            }
          },
          "invariant_ids": [
            "SELECT_ENUM_DOMAIN"
          ],
          "props": {
            "label": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "options": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "item": {
                      "constraints": {
                        "fields": {
                          "label": {
                            "constraints": {
                              "max_length": 120
                            },
                            "type": "STRING"
                          },
                          "value": {
                            "constraints": {
                              "max_length": 8192
                            },
                            "type": "STRING"
                          }
                        }
                      },
                      "type": "RECORD"
                    },
                    "max_length": 500
                  },
                  "type": "LIST"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "required": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "BOOLEAN"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "2.0.0"
      }
    },
    "input.text": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:8411032472d720491ab2528c9bc2e6d6af1d8e1ee752397e0bc45b49f8ee2aa7",
        "execution_status": "ACTIVE",
        "id": "input.text",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "bind": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 8192
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": true,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "STATE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "change": {
              "invariant_ids": [],
              "payload": {
                "binding_key": "bind",
                "kind": "BOUND_STRING_NARROWED_BY_PROP",
                "prop_key": "max_length"
              }
            }
          },
          "invariant_ids": [
            "INPUT_TEXT_BOUND"
          ],
          "props": {
            "label": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "max_length": {
              "invariant_ids": [
                "NUM_INT_RANGE_0_8192"
              ],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "placeholder": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 500
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "required": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "BOOLEAN"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "input.toggle": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:adc1800d5b0e690f489aaaac9f6689780b47c054d6a928fe078cfb4b01345fa3",
        "execution_status": "ACTIVE",
        "id": "input.toggle",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "bind": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "BOOLEAN"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": true,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "STATE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "change": {
              "invariant_ids": [],
              "payload": {
                "descriptor": {
                  "constraints": {
                    "fields": {
                      "value": {
                        "type": "BOOLEAN"
                      }
                    }
                  },
                  "type": "RECORD"
                },
                "kind": "STATIC"
              }
            }
          },
          "invariant_ids": [],
          "props": {}
        },
        "version": "1.0.0"
      }
    },
    "layout.container": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:820a6c4d0f54d645f8f1496958f47556dc07e99aa3d1691546793b5462b9cf82",
        "execution_status": "ACTIVE",
        "id": "layout.container",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {},
          "capability_state": "NONE",
          "composition": {
            "children": true,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [],
          "props": {
            "align": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "allowed": [
                      "START",
                      "CENTER",
                      "END",
                      "STRETCH"
                    ]
                  },
                  "type": "ENUM"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "direction": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "allowed": [
                      "ROW",
                      "COLUMN"
                    ]
                  },
                  "type": "ENUM"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "gap": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "allowed": [
                      "NONE",
                      "XS",
                      "SM",
                      "MD",
                      "LG",
                      "XL"
                    ]
                  },
                  "type": "ENUM"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "logic.random": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_RULE",
        "execution_contract_digest": "sha256:41b5143ea1a81c60ef4d457a1eeaf75b24c805db5a5ac1baf5b5d529331d63f7",
        "execution_status": "ACTIVE",
        "id": "logic.random",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {
            "choose_item": {
              "args": {
                "items": {
                  "invariant_ids": [],
                  "matcher": {
                    "descriptor": {
                      "constraints": {
                        "item": {
                          "constraints": {
                            "max_length": 8192
                          },
                          "type": "STRING"
                        },
                        "max_length": 500
                      },
                      "type": "LIST"
                    },
                    "kind": "EXACT"
                  },
                  "required": true,
                  "source_kinds": [
                    "LITERAL",
                    "STATE",
                    "RULE",
                    "OP",
                    "EVENT",
                    "SCOPE"
                  ]
                }
              },
              "invariant_ids": []
            },
            "sample_number": {
              "args": {
                "max": {
                  "invariant_ids": [],
                  "matcher": {
                    "descriptor": {
                      "type": "NUMBER"
                    },
                    "kind": "EXACT"
                  },
                  "required": true,
                  "source_kinds": [
                    "LITERAL",
                    "STATE",
                    "RULE",
                    "OP",
                    "EVENT",
                    "SCOPE"
                  ]
                },
                "min": {
                  "invariant_ids": [],
                  "matcher": {
                    "descriptor": {
                      "type": "NUMBER"
                    },
                    "kind": "EXACT"
                  },
                  "required": true,
                  "source_kinds": [
                    "LITERAL",
                    "STATE",
                    "RULE",
                    "OP",
                    "EVENT",
                    "SCOPE"
                  ]
                }
              },
              "invariant_ids": [
                "RANDOM_MIN_MAX"
              ]
            }
          },
          "bindings": {},
          "capability_state": {
            "constraints": {
              "fields": {
                "last_index": {
                  "type": "NUMBER"
                },
                "last_item": {
                  "constraints": {
                    "max_length": 8192
                  },
                  "type": "STRING"
                },
                "last_number": {
                  "type": "NUMBER"
                }
              },
              "optional_fields": [
                "last_index",
                "last_item",
                "last_number"
              ]
            },
            "type": "RECORD"
          },
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [],
          "props": {}
        },
        "version": "1.0.0"
      }
    },
    "logic.score": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_RULE",
        "execution_contract_digest": "sha256:c50e5907fabd442f2428d8b2f3a0f352116fcba0c278201071306b6f52d2581b",
        "execution_status": "ACTIVE",
        "id": "logic.score",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {
            "increment": {
              "args": {
                "delta": {
                  "invariant_ids": [],
                  "matcher": {
                    "descriptor": {
                      "type": "NUMBER"
                    },
                    "kind": "EXACT"
                  },
                  "required": true,
                  "source_kinds": [
                    "LITERAL",
                    "STATE",
                    "RULE",
                    "OP",
                    "EVENT",
                    "SCOPE"
                  ]
                }
              },
              "invariant_ids": []
            },
            "reset": {
              "args": {},
              "invariant_ids": []
            },
            "set": {
              "args": {
                "value": {
                  "invariant_ids": [],
                  "matcher": {
                    "descriptor": {
                      "type": "NUMBER"
                    },
                    "kind": "EXACT"
                  },
                  "required": true,
                  "source_kinds": [
                    "LITERAL",
                    "STATE",
                    "RULE",
                    "OP",
                    "EVENT",
                    "SCOPE"
                  ]
                }
              },
              "invariant_ids": []
            }
          },
          "bindings": {},
          "capability_state": {
            "constraints": {
              "fields": {
                "value": {
                  "type": "NUMBER"
                }
              }
            },
            "type": "RECORD"
          },
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "change": {
              "invariant_ids": [],
              "payload": {
                "descriptor": {
                  "constraints": {
                    "fields": {
                      "value": {
                        "type": "NUMBER"
                      }
                    }
                  },
                  "type": "RECORD"
                },
                "kind": "STATIC"
              }
            }
          },
          "invariant_ids": [
            "SCORE_BOUNDS"
          ],
          "props": {
            "initial": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "max": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "min": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "logic.timer": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_RULE",
        "execution_contract_digest": "sha256:a75abb4f59678981e0ee148c7bc6aa9cadb43d3dc362e365c4117cd3d7ba4800",
        "execution_status": "ACTIVE",
        "id": "logic.timer",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 1
        },
        "validator": {
          "actions": {
            "pause": {
              "args": {},
              "invariant_ids": []
            },
            "reset": {
              "args": {},
              "invariant_ids": []
            },
            "resume": {
              "args": {},
              "invariant_ids": []
            },
            "start": {
              "args": {},
              "invariant_ids": []
            }
          },
          "bindings": {},
          "capability_state": {
            "constraints": {
              "fields": {
                "duration_ms": {
                  "type": "NUMBER"
                },
                "remaining_ms": {
                  "type": "NUMBER"
                },
                "status": {
                  "constraints": {
                    "allowed": [
                      "IDLE",
                      "RUNNING",
                      "PAUSED",
                      "COMPLETE"
                    ]
                  },
                  "type": "ENUM"
                }
              }
            },
            "type": "RECORD"
          },
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {
            "complete": {
              "invariant_ids": [],
              "payload": {
                "descriptor": {
                  "constraints": {
                    "fields": {}
                  },
                  "type": "RECORD"
                },
                "kind": "STATIC"
              }
            }
          },
          "invariant_ids": [],
          "props": {
            "duration_ms": {
              "invariant_ids": [
                "NUM_INTEGER",
                "NUM_GTE_ZERO"
              ],
              "matcher": {
                "descriptor": {
                  "type": "NUMBER"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    },
    "system.notice": {
      "1.0.0": {
        "availability": "ENABLED",
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
        "execution_class": "LOCAL_REACT",
        "execution_contract_digest": "sha256:d3f570c6548c47bcdc146829334610bd5b47b116d99960182095cbec6a99142a",
        "execution_status": "ACTIVE",
        "id": "system.notice",
        "permission_class": "NONE",
        "resource_budget": {
          "maxActionBindings": 100,
          "maxConcurrentTimers": 10,
          "maxEventBindings": 200,
          "maxInstancesPerBlueprint": 100,
          "maxLocalStateBytes": 131072,
          "maxSerializedPropsBytes": 262144,
          "mediaAutoplayAllowed": false,
          "networkAccessAllowed": false
        },
        "resource_usage": {
          "timerSlotsPerInstance": 0
        },
        "validator": {
          "actions": {},
          "bindings": {
            "action_refs": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "item": {
                      "constraints": {
                        "max_length": 64
                      },
                      "type": "STRING"
                    },
                    "max_length": 16
                  },
                  "type": "LIST"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "ACTION_ID",
              "required": false,
              "source_kinds": [
                "LITERAL"
              ]
            },
            "message": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 1000
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": true,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            },
            "title": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "max_length": 120
                  },
                  "type": "STRING"
                },
                "kind": "EXACT"
              },
              "mutable_state_required": false,
              "reference": "NONE",
              "required": false,
              "source_kinds": [
                "LITERAL",
                "STATE",
                "RULE",
                "OP",
                "SCOPE"
              ]
            }
          },
          "capability_state": "NONE",
          "composition": {
            "children": false,
            "repeat": false
          },
          "events": {},
          "invariant_ids": [],
          "props": {
            "severity": {
              "invariant_ids": [],
              "matcher": {
                "descriptor": {
                  "constraints": {
                    "allowed": [
                      "INFO",
                      "SUCCESS",
                      "WARNING",
                      "ERROR"
                    ]
                  },
                  "type": "ENUM"
                },
                "kind": "EXACT"
              },
              "required": true,
              "source_kinds": [
                "LITERAL"
              ]
            }
          }
        },
        "version": "1.0.0"
      }
    }
  },
  "registry_digest": "sha256:946e851b6a78e81f6f7dc42c00659af6cc9ddfedbd21d05e4c4e12b96054c52b",
  "registry_version": "7.0.0",
  "runtime_version": "1.0.0",
  "validator_registry_digest": "sha256:d1cc3614eb8defe5c5e66abac79a4b3446ecc220c00703655002225922220188"
};
