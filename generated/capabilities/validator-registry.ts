// Generated from the canonical Capability Registry. Do not edit.
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";

export const VALIDATOR_REGISTRY: ValidatorRegistry = {
  "capabilities": {
    "action.button": {
      "1.0.0": {
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
  "registry_digest": "sha256:0a633311ee253bf6424c2201292710f6cd8f0943ece35584513410e614705ea0",
  "registry_version": "4.0.0"
};
