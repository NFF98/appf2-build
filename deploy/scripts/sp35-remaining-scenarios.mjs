/** SPEC H-001 0.19 / 0.24 / 0.25 frozen BEFORE model generation. Trusted acceptance data only. */
export const scenarios={
 "g6-length": {
  "id": "g6-length",
  "title": "長度換算器",
  "category": "tool",
  "prompt": "製作「長度換算器」。標題顯示「長度換算器」。提供原生number數字欄位「公尺」和按鈕「換算」「清除」。輸入1公尺後換算顯示「公分：100.00」。輸入1公尺後換算顯示「毫米：1000.00」。輸入2.5公尺後換算顯示「公分：250.00」。輸入0公尺後換算顯示「公分：0.00」。輸入負1公尺後換算顯示「輸入不可為負數」，清掉舊成功結果。先換算1公尺再按清除顯示「尚未換算」，輸入框清空。未計算時也顯示「尚未換算」。換算公式公分=公尺乘100、毫米=公尺乘1000，均顯示兩位小數，連續改數字或重整後仍可計算。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「長度換算器」",
    [],
    {
     "kind": "text_includes",
     "text": "長度換算器"
    }
   ],
   [
    "centimeter",
    "輸入1公尺後換算顯示「公分：100.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "公分：100.00"
    }
   ],
   [
    "millimeter",
    "輸入1公尺後換算顯示「毫米：1000.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "毫米：1000.00"
    }
   ],
   [
    "fraction",
    "輸入2.5公尺後換算顯示「公分：250.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "2.5"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "公分：250.00"
    }
   ],
   [
    "zero",
    "輸入0公尺後換算顯示「公分：0.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "0"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "公分：0.00"
    }
   ],
   [
    "negative",
    "輸入負1公尺後換算顯示「輸入不可為負數」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "-1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "輸入不可為負數"
    }
   ],
   [
    "clear",
    "先換算1公尺再按清除顯示「尚未換算」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "公尺",
      "value": "1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "換算"
     },
     {
      "action": "click",
      "role": "button",
      "name": "清除"
     }
    ],
    {
     "kind": "text_appears",
     "text": "尚未換算"
    }
   ]
  ],
  "guest": [
   {
    "action": "fill",
    "args": [
     "公尺",
     "2.5"
    ]
   },
   {
    "action": "click",
    "args": [
     "換算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "公分：250.00"
    ]
   },
   {
    "action": "expect",
    "args": [
     "毫米：2500.00"
    ]
   },
   {
    "action": "fill",
    "args": [
     "公尺",
     "-1"
    ]
   },
   {
    "action": "click",
    "args": [
     "換算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "輸入不可為負數"
    ]
   },
   {
    "action": "click",
    "args": [
     "清除"
    ]
   },
   {
    "action": "expect",
    "args": [
     "尚未換算"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "fill",
    "args": [
     "公尺",
     "1.25"
    ]
   },
   {
    "action": "click",
    "args": [
     "換算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "公分：125.00"
    ]
   }
  ]
 },
 "g7-memory": {
  "id": "g7-memory",
  "title": "水果記憶配對",
  "category": "game",
  "prompt": "製作六張卡片的「水果記憶配對」。標題顯示「水果記憶配對」。按鈕可存取名稱固定為「第1張」到「第6張」，翻面不改名稱。初始顯示「配對數：0」。第1/2張是蘋果、第3/4張是香蕉、第5/6張是葡萄，初始卡面隱藏。按第1張顯示「第1張：蘋果」。按第1張再按第2張顯示「配對數：1」。按第1張再按第3張顯示「配對失敗」，這個狀態文字持續到下次點擊；未配對卡片稍後蓋回。依序按第1、2、3、4、5、6張顯示「全部配對完成」，已配對卡片禁再點。完成後顯示「配對數：3」。按第1張再按重新開始顯示「配對數：0」，清除翻牌與勝利狀態。按鈕名為「重新開始」，可再次完成一局。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「水果記憶配對」",
    [],
    {
     "kind": "text_includes",
     "text": "水果記憶配對"
    }
   ],
   [
    "initial",
    "初始顯示「配對數：0」",
    [],
    {
     "kind": "text_includes",
     "text": "配對數：0"
    }
   ],
   [
    "flip",
    "按第1張顯示「第1張：蘋果」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1張"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第1張：蘋果"
    }
   ],
   [
    "pair",
    "按第1張再按第2張顯示「配對數：1」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第2張"
     }
    ],
    {
     "kind": "text_appears",
     "text": "配對數：1"
    }
   ],
   [
    "mismatch",
    "按第1張再按第3張顯示「配對失敗」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第3張"
     }
    ],
    {
     "kind": "text_appears",
     "text": "配對失敗"
    }
   ],
   [
    "complete",
    "依序按第1、2、3、4、5、6張顯示「全部配對完成」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第2張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第3張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第4張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第5張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第6張"
     }
    ],
    {
     "kind": "text_appears",
     "text": "全部配對完成"
    }
   ],
   [
    "reset",
    "按第1張再按重新開始顯示「配對數：0」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1張"
     },
     {
      "action": "click",
      "role": "button",
      "name": "重新開始"
     }
    ],
    {
     "kind": "text_appears",
     "text": "配對數：0"
    }
   ]
  ],
  "guest": [
   {
    "action": "click",
    "args": [
     "第1張"
    ]
   },
   {
    "action": "click",
    "args": [
     "第2張"
    ]
   },
   {
    "action": "click",
    "args": [
     "第3張"
    ]
   },
   {
    "action": "click",
    "args": [
     "第4張"
    ]
   },
   {
    "action": "click",
    "args": [
     "第5張"
    ]
   },
   {
    "action": "click",
    "args": [
     "第6張"
    ]
   },
   {
    "action": "expect",
    "args": [
     "全部配對完成"
    ]
   },
   {
    "action": "expect",
    "args": [
     "配對數：3"
    ]
   },
   {
    "action": "blocked",
    "args": [
     [
      "第1張",
      "第2張",
      "第3張",
      "第4張",
      "第5張",
      "第6張"
     ]
    ]
   },
   {
    "action": "click",
    "args": [
     "重新開始"
    ]
   },
   {
    "action": "expect",
    "args": [
     "配對數：0"
    ]
   },
   {
    "action": "click",
    "args": [
     "第3張"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第3張：香蕉"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "配對數：0"
    ]
   },
   {
    "action": "click",
    "args": [
     "第1張"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第1張：蘋果"
    ]
   }
  ]
 },
 "g8-lights": {
  "id": "g8-lights",
  "title": "四燈切換謎題",
  "category": "game",
  "prompt": "製作「四燈切換謎題」。標題顯示「四燈切換謎題」。四個可點燈按鈕名稱固定「第1燈」到「第4燈」。初始顯示「第1燈：暗」「第2燈：暗」「第3燈：暗」「第4燈：暗」。點一燈會同時切換自己和右邊鄰燈，第四燈右鄰為第一燈，暗變亮亮變暗。按第1燈顯示「第1燈：亮」。按第1燈顯示「第2燈：亮」。按第1燈再按第1燈顯示「第1燈：暗」。按第1燈再按第3燈顯示「解謎成功」，此時四燈都亮並禁止再切換。按第1燈再按重新開始顯示「第1燈：暗」，四燈重置為暗、可重新解謎。按鈕名為「重新開始」。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「四燈切換謎題」",
    [],
    {
     "kind": "text_includes",
     "text": "四燈切換謎題"
    }
   ],
   [
    "initial",
    "初始顯示「第1燈：暗」",
    [],
    {
     "kind": "text_includes",
     "text": "第1燈：暗"
    }
   ],
   [
    "self",
    "按第1燈顯示「第1燈：亮」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1燈"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第1燈：亮"
    }
   ],
   [
    "neighbor",
    "按第1燈顯示「第2燈：亮」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1燈"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第2燈：亮"
    }
   ],
   [
    "toggle_back",
    "按第1燈再按第1燈顯示「第1燈：暗」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1燈"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第1燈"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第1燈：暗"
    }
   ],
   [
    "win",
    "按第1燈再按第3燈顯示「解謎成功」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1燈"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第3燈"
     }
    ],
    {
     "kind": "text_appears",
     "text": "解謎成功"
    }
   ],
   [
    "reset",
    "按第1燈再按重新開始顯示「第1燈：暗」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1燈"
     },
     {
      "action": "click",
      "role": "button",
      "name": "重新開始"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第1燈：暗"
    }
   ]
  ],
  "guest": [
   {
    "action": "click",
    "args": [
     "第1燈"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第2燈：亮"
    ]
   },
   {
    "action": "click",
    "args": [
     "第3燈"
    ]
   },
   {
    "action": "expect",
    "args": [
     "解謎成功"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第1燈：亮"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第2燈：亮"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第3燈：亮"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第4燈：亮"
    ]
   },
   {
    "action": "blocked",
    "args": [
     [
      "第1燈",
      "第2燈",
      "第3燈",
      "第4燈"
     ]
    ]
   },
   {
    "action": "click",
    "args": [
     "重新開始"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第1燈：暗"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "click",
    "args": [
     "第1燈"
    ]
   },
   {
    "action": "click",
    "args": [
     "第3燈"
    ]
   },
   {
    "action": "expect",
    "args": [
     "解謎成功"
    ]
   }
  ]
 },
 "g9-connect": {
  "id": "g9-connect",
  "title": "四乘四連線棋",
  "category": "game",
  "prompt": "製作「四乘四連線棋」雙人遊戲。標題顯示「四乘四連線棋」。棋盤4列4欄，列由上到下1到4，按鈕固定叫「第1欄」到「第4欄」。紅藍交替落子，按欄後棋子落到該欄最低空格，滿欄禁止落子，連續四顆同色橫直斜線獲勝。初始顯示「輪到：紅」。按第1欄顯示「第4列第1格：紅」。按第1欄後顯示「輪到：藍」。按第1欄再按第2欄顯示「第4列第2格：藍」。依序按第1、2、1、2、1、2、1欄顯示「勝者：紅」，獲勝後禁止再落子。按第1欄再按重新開始顯示「輪到：紅」，棋盤清空且能再玩。按鈕名為「重新開始」。每個已填格都顯示包含列欄與顏色的上述文字。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「四乘四連線棋」",
    [],
    {
     "kind": "text_includes",
     "text": "四乘四連線棋"
    }
   ],
   [
    "initial",
    "初始顯示「輪到：紅」",
    [],
    {
     "kind": "text_includes",
     "text": "輪到：紅"
    }
   ],
   [
    "red_piece",
    "按第1欄顯示「第4列第1格：紅」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第4列第1格：紅"
    }
   ],
   [
    "turn",
    "按第1欄後顯示「輪到：藍」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "輪到：藍"
    }
   ],
   [
    "blue_piece",
    "按第1欄再按第2欄顯示「第4列第2格：藍」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第2欄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "第4列第2格：藍"
    }
   ],
   [
    "win",
    "依序按第1、2、1、2、1、2、1欄顯示「勝者：紅」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第2欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第2欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第2欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "勝者：紅"
    }
   ],
   [
    "reset",
    "按第1欄再按重新開始顯示「輪到：紅」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "第1欄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "重新開始"
     }
    ],
    {
     "kind": "text_appears",
     "text": "輪到：紅"
    }
   ]
  ],
  "guest": [
   {
    "action": "click",
    "args": [
     "第1欄"
    ]
   },
   {
    "action": "click",
    "args": [
     "第2欄"
    ]
   },
   {
    "action": "click",
    "args": [
     "第1欄"
    ]
   },
   {
    "action": "click",
    "args": [
     "第2欄"
    ]
   },
   {
    "action": "click",
    "args": [
     "第1欄"
    ]
   },
   {
    "action": "click",
    "args": [
     "第2欄"
    ]
   },
   {
    "action": "click",
    "args": [
     "第1欄"
    ]
   },
   {
    "action": "expect",
    "args": [
     "勝者：紅"
    ]
   },
   {
    "action": "blocked",
    "args": [
     [
      "第1欄",
      "第2欄",
      "第3欄",
      "第4欄"
     ]
    ]
   },
   {
    "action": "click",
    "args": [
     "重新開始"
    ]
   },
   {
    "action": "expect",
    "args": [
     "輪到：紅"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "click",
    "args": [
     "第1欄"
    ]
   },
   {
    "action": "expect",
    "args": [
     "第4列第1格：紅"
    ]
   }
  ]
 },
 "g10-books": {
  "id": "g10-books",
  "title": "閱讀書單",
  "category": "postgres",
  "prompt": "製作「閱讀書單」。標題顯示「閱讀書單」。按鈕名稱「新增書籍」「標記已讀」「刪除書籍」。初始顯示「書籍數：0」。按新增書籍顯示「書籍數：1」。按新增書籍顯示「書名：小王子」。按新增書籍再按標記已讀顯示「狀態：已讀」。每次新增存一筆title小王子、read為false，標記已讀更新該筆read為true，刪除以record_id刪掉該筆。按新增書籍再按刪除書籍顯示「書籍數：0」。按新增書籍、刪除書籍、再新增書籍顯示「書名：小王子」。無紀錄時標記/刪除不可產生假結果；有紀錄時顯示原紀錄的書名與狀態，重開需保留已讀狀態。必須透過平台window.appf2Records的Promise list/create/read/update/delete保存到真PostgreSQL，每次動作await成功再更新UI，啟動從list讀回，不得記憶體替代；重新整理保留，不同瀏覽器viewer資料完全隔離。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「閱讀書單」",
    [],
    {
     "kind": "text_includes",
     "text": "閱讀書單"
    }
   ],
   [
    "initial",
    "初始顯示「書籍數：0」",
    [],
    {
     "kind": "text_includes",
     "text": "書籍數：0"
    }
   ],
   [
    "create",
    "按新增書籍顯示「書籍數：1」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "新增書籍"
     }
    ],
    {
     "kind": "text_appears",
     "text": "書籍數：1"
    }
   ],
   [
    "read",
    "按新增書籍顯示「書名：小王子」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "新增書籍"
     }
    ],
    {
     "kind": "text_appears",
     "text": "書名：小王子"
    }
   ],
   [
    "update",
    "按新增書籍再按標記已讀顯示「狀態：已讀」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "新增書籍"
     },
     {
      "action": "click",
      "role": "button",
      "name": "標記已讀"
     }
    ],
    {
     "kind": "text_appears",
     "text": "狀態：已讀"
    }
   ],
   [
    "delete",
    "按新增書籍再按刪除書籍顯示「書籍數：0」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "新增書籍"
     },
     {
      "action": "click",
      "role": "button",
      "name": "刪除書籍"
     }
    ],
    {
     "kind": "text_appears",
     "text": "書籍數：0"
    }
   ],
   [
    "recreate",
    "按新增書籍、刪除書籍、再新增書籍顯示「書名：小王子」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "新增書籍"
     },
     {
      "action": "click",
      "role": "button",
      "name": "刪除書籍"
     },
     {
      "action": "click",
      "role": "button",
      "name": "新增書籍"
     }
    ],
    {
     "kind": "text_appears",
     "text": "書名：小王子"
    }
   ]
  ],
  "guest": [
   {
    "action": "expect",
    "args": [
     "書籍數：0"
    ]
   },
   {
    "action": "click",
    "args": [
     "新增書籍"
    ]
   },
   {
    "action": "expect",
    "args": [
     "書名：小王子"
    ]
   },
   {
    "action": "click",
    "args": [
     "標記已讀"
    ]
   },
   {
    "action": "expect",
    "args": [
     "狀態：已讀"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "狀態：已讀"
    ]
   },
   {
    "action": "isolated",
    "args": [
     "書籍數：0",
     "書名：小王子"
    ]
   },
   {
    "action": "click",
    "args": [
     "刪除書籍"
    ]
   },
   {
    "action": "expect",
    "args": [
     "書籍數：0"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "書籍數：0"
    ]
   },
   {
    "action": "click",
    "args": [
     "新增書籍"
    ]
   },
   {
    "action": "expect",
    "args": [
     "書籍數：1"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "書名：小王子"
    ]
   }
  ]
 },
 "g11-water": {
  "id": "g11-water",
  "title": "每日喝水紀錄",
  "category": "postgres",
  "prompt": "製作「每日喝水紀錄」。標題顯示「每日喝水紀錄」。按鈕固定叫「建立紀錄」「再喝一杯」「刪除紀錄」。初始顯示「杯數：0」。按建立紀錄顯示「杯數：1」。按建立紀錄顯示「紀錄數：1」。按建立紀錄再按再喝一杯顯示「杯數：2」。按建立紀錄、再喝一杯、再喝一杯顯示「杯數：3」。建立只存一筆{kind:'water',cups:1}，再次建立不可重複新增；再喝一杯更新同record_id的cups加1；刪除刪去該紀錄。按建立紀錄再按刪除紀錄顯示「杯數：0」。按建立紀錄、刪除紀錄、再建立紀錄顯示「杯數：1」。沒有紀錄時再喝一杯不可虛增，刪除後刷新仍0。必須透過平台window.appf2Records的Promise list/create/read/update/delete保存到真PostgreSQL，每次動作await成功再更新UI，啟動從list讀回，不得記憶體替代；重新整理保留，不同瀏覽器viewer資料完全隔離。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「每日喝水紀錄」",
    [],
    {
     "kind": "text_includes",
     "text": "每日喝水紀錄"
    }
   ],
   [
    "initial",
    "初始顯示「杯數：0」",
    [],
    {
     "kind": "text_includes",
     "text": "杯數：0"
    }
   ],
   [
    "create",
    "按建立紀錄顯示「杯數：1」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "建立紀錄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "杯數：1"
    }
   ],
   [
    "count",
    "按建立紀錄顯示「紀錄數：1」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "建立紀錄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "紀錄數：1"
    }
   ],
   [
    "update",
    "按建立紀錄再按再喝一杯顯示「杯數：2」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "建立紀錄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "再喝一杯"
     }
    ],
    {
     "kind": "text_appears",
     "text": "杯數：2"
    }
   ],
   [
    "delete",
    "按建立紀錄再按刪除紀錄顯示「杯數：0」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "建立紀錄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "刪除紀錄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "杯數：0"
    }
   ],
   [
    "recreate",
    "按建立紀錄、刪除紀錄、再建立紀錄顯示「杯數：1」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "建立紀錄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "刪除紀錄"
     },
     {
      "action": "click",
      "role": "button",
      "name": "建立紀錄"
     }
    ],
    {
     "kind": "text_appears",
     "text": "杯數：1"
    }
   ]
  ],
  "guest": [
   {
    "action": "expect",
    "args": [
     "杯數：0"
    ]
   },
   {
    "action": "click",
    "args": [
     "建立紀錄"
    ]
   },
   {
    "action": "expect",
    "args": [
     "杯數：1"
    ]
   },
   {
    "action": "click",
    "args": [
     "再喝一杯"
    ]
   },
   {
    "action": "expect",
    "args": [
     "杯數：2"
    ]
   },
   {
    "action": "click",
    "args": [
     "再喝一杯"
    ]
   },
   {
    "action": "expect",
    "args": [
     "杯數：3"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "杯數：3"
    ]
   },
   {
    "action": "isolated",
    "args": [
     "杯數：0",
     "杯數：3"
    ]
   },
   {
    "action": "click",
    "args": [
     "刪除紀錄"
    ]
   },
   {
    "action": "expect",
    "args": [
     "杯數：0"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "杯數：0"
    ]
   },
   {
    "action": "click",
    "args": [
     "建立紀錄"
    ]
   },
   {
    "action": "expect",
    "args": [
     "杯數：1"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "杯數：1"
    ]
   }
  ]
 },
 "g12-reading": {
  "id": "g12-reading",
  "title": "閱讀時間估算器",
  "category": "tool",
  "prompt": "製作「閱讀時間估算器」。標題顯示「閱讀時間估算器」。提供原生number欄位「字數」「每分鐘字數」，按鈕「估算」「清除」。未估算時顯示「尚未估算」。字數1200、每分鐘300後估算顯示「分鐘：4.00」。字數900、每分鐘300後估算顯示「分鐘：3.00」。字數150、每分鐘200後估算顯示「分鐘：0.75」。字數0、每分鐘300後估算顯示「分鐘：0.00」。字數1200、每分鐘0後估算顯示「速度必須大於0」，移除舊成功結果，不得Infinity或NaN。先估算1200字、每分鐘300再按清除顯示「尚未估算」，欄位回到字數0、速度300。以字數除以每分鐘字數計算分鐘並顯示兩位小數；負字數顯示「字數不可為負數」。可連續修改再算，刷新後仍可填表操作。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「閱讀時間估算器」",
    [],
    {
     "kind": "text_includes",
     "text": "閱讀時間估算器"
    }
   ],
   [
    "four",
    "字數1200、每分鐘300後估算顯示「分鐘：4.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "1200"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "300"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "分鐘：4.00"
    }
   ],
   [
    "three",
    "字數900、每分鐘300後估算顯示「分鐘：3.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "900"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "300"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "分鐘：3.00"
    }
   ],
   [
    "fraction",
    "字數150、每分鐘200後估算顯示「分鐘：0.75」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "150"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "200"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "分鐘：0.75"
    }
   ],
   [
    "zero",
    "字數0、每分鐘300後估算顯示「分鐘：0.00」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "0"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "300"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "分鐘：0.00"
    }
   ],
   [
    "invalid",
    "字數1200、每分鐘0後估算顯示「速度必須大於0」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "1200"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "300"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "1200"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "0"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     }
    ],
    {
     "kind": "text_appears",
     "text": "速度必須大於0"
    }
   ],
   [
    "clear",
    "先估算1200字、每分鐘300再按清除顯示「尚未估算」",
    [
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "字數",
      "value": "1200"
     },
     {
      "action": "fill",
      "role": "spinbutton",
      "name": "每分鐘字數",
      "value": "300"
     },
     {
      "action": "click",
      "role": "button",
      "name": "估算"
     },
     {
      "action": "click",
      "role": "button",
      "name": "清除"
     }
    ],
    {
     "kind": "text_appears",
     "text": "尚未估算"
    }
   ]
  ],
  "guest": [
   {
    "action": "fill",
    "args": [
     "字數",
     "1200"
    ]
   },
   {
    "action": "fill",
    "args": [
     "每分鐘字數",
     "300"
    ]
   },
   {
    "action": "click",
    "args": [
     "估算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "分鐘：4.00"
    ]
   },
   {
    "action": "fill",
    "args": [
     "字數",
     "150"
    ]
   },
   {
    "action": "fill",
    "args": [
     "每分鐘字數",
     "200"
    ]
   },
   {
    "action": "click",
    "args": [
     "估算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "分鐘：0.75"
    ]
   },
   {
    "action": "fill",
    "args": [
     "每分鐘字數",
     "0"
    ]
   },
   {
    "action": "click",
    "args": [
     "估算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "速度必須大於0"
    ]
   },
   {
    "action": "absent",
    "args": [
     "Infinity"
    ]
   },
   {
    "action": "absent",
    "args": [
     "NaN"
    ]
   },
   {
    "action": "click",
    "args": [
     "清除"
    ]
   },
   {
    "action": "expect",
    "args": [
     "尚未估算"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "fill",
    "args": [
     "字數",
     "600"
    ]
   },
   {
    "action": "fill",
    "args": [
     "每分鐘字數",
     "240"
    ]
   },
   {
    "action": "click",
    "args": [
     "估算"
    ]
   },
   {
    "action": "expect",
    "args": [
     "分鐘：2.50"
    ]
   }
  ]
 },
 "g13-order": {
  "id": "g13-order",
  "title": "數字按序挑戰",
  "category": "game",
  "prompt": "製作「數字按序挑戰」。標題顯示「數字按序挑戰」。提供可存取名稱固定為「數字1」到「數字5」的五個按鈕。初始顯示「下一個：1」。按數字1顯示「下一個：2」。按數字1再按數字2顯示「下一個：3」。首次按數字3顯示「順序錯誤」，下一個仍1，可再從1開始。必須按1、2、3、4、5的順序，每次正確才前進，錯誤顯示提示並回到待按1；不能用固定成功畫面。依序按數字1、2、3、4、5顯示「挑戰完成」，完成後所有數字按鈕不能再改變遊戲。按數字1再按重新開始顯示「下一個：1」，清除錯誤、勝利和進度，能再玩完整一局；按鈕叫「重新開始」。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「數字按序挑戰」",
    [],
    {
     "kind": "text_includes",
     "text": "數字按序挑戰"
    }
   ],
   [
    "initial",
    "初始顯示「下一個：1」",
    [],
    {
     "kind": "text_includes",
     "text": "下一個：1"
    }
   ],
   [
    "one",
    "按數字1顯示「下一個：2」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "數字1"
     }
    ],
    {
     "kind": "text_appears",
     "text": "下一個：2"
    }
   ],
   [
    "two",
    "按數字1再按數字2顯示「下一個：3」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "數字1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "數字2"
     }
    ],
    {
     "kind": "text_appears",
     "text": "下一個：3"
    }
   ],
   [
    "wrong",
    "首次按數字3顯示「順序錯誤」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "數字3"
     }
    ],
    {
     "kind": "text_appears",
     "text": "順序錯誤"
    }
   ],
   [
    "win",
    "依序按數字1、2、3、4、5顯示「挑戰完成」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "數字1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "數字2"
     },
     {
      "action": "click",
      "role": "button",
      "name": "數字3"
     },
     {
      "action": "click",
      "role": "button",
      "name": "數字4"
     },
     {
      "action": "click",
      "role": "button",
      "name": "數字5"
     }
    ],
    {
     "kind": "text_appears",
     "text": "挑戰完成"
    }
   ],
   [
    "reset",
    "按數字1再按重新開始顯示「下一個：1」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "數字1"
     },
     {
      "action": "click",
      "role": "button",
      "name": "重新開始"
     }
    ],
    {
     "kind": "text_appears",
     "text": "下一個：1"
    }
   ]
  ],
  "guest": [
   {
    "action": "click",
    "args": [
     "數字3"
    ]
   },
   {
    "action": "expect",
    "args": [
     "順序錯誤"
    ]
   },
   {
    "action": "expect",
    "args": [
     "下一個：1"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字1"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字2"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字3"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字4"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字5"
    ]
   },
   {
    "action": "expect",
    "args": [
     "挑戰完成"
    ]
   },
   {
    "action": "blocked",
    "args": [
     [
      "數字1",
      "數字2",
      "數字3",
      "數字4",
      "數字5"
     ]
    ]
   },
   {
    "action": "click",
    "args": [
     "重新開始"
    ]
   },
   {
    "action": "expect",
    "args": [
     "下一個：1"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字1"
    ]
   },
   {
    "action": "expect",
    "args": [
     "下一個：2"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "expect",
    "args": [
     "下一個：1"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字1"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字2"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字3"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字4"
    ]
   },
   {
    "action": "click",
    "args": [
     "數字5"
    ]
   },
   {
    "action": "expect",
    "args": [
     "挑戰完成"
    ]
   }
  ]
 },
 "g14-escape": {
  "id": "g14-escape",
  "title": "小屋逃脫",
  "category": "game",
  "prompt": "製作「小屋逃脫」。標題顯示「小屋逃脫」。提供名稱固定「拾取鑰匙」「打開木門」「走向出口」「重新開始」的按鈕。初始顯示「鑰匙：未持有」與「木門：關閉」。未拾鑰匙先按打開木門顯示「需要鑰匙」，門保持關閉。按拾取鑰匙顯示「鑰匙：已持有」。按拾取鑰匙再按打開木門顯示「木門：已開」。未開門不能完成。依序按拾取鑰匙、打開木門、走向出口顯示「逃脫成功」。完成後前三個按鈕不能再改變狀態。按拾取鑰匙再按重新開始顯示「鑰匙：未持有」，木門關閉、錯誤與成功訊息清除，可再完整遊玩；刷新也能重新遊玩。所有狀態、錯誤與成功文字只在對應實際狀態顯示，玩法說明不可預先印出結果文案。請由AI自由撰寫至少三個互相import的src/ TypeScript模組及CSS，不得用模板、mock、固定成功畫面、外部網路、外部套件或localStorage。按鈕與文字依以下名稱，手機也可完整操作。",
  "cases": [
   [
    "title",
    "標題顯示「小屋逃脫」",
    [],
    {
     "kind": "text_includes",
     "text": "小屋逃脫"
    }
   ],
   [
    "initial",
    "初始顯示「鑰匙：未持有」",
    [],
    {
     "kind": "text_includes",
     "text": "鑰匙：未持有"
    }
   ],
   [
    "needs_key",
    "未拾鑰匙先按打開木門顯示「需要鑰匙」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "打開木門"
     }
    ],
    {
     "kind": "text_appears",
     "text": "需要鑰匙"
    }
   ],
   [
    "key",
    "按拾取鑰匙顯示「鑰匙：已持有」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "拾取鑰匙"
     }
    ],
    {
     "kind": "text_appears",
     "text": "鑰匙：已持有"
    }
   ],
   [
    "door",
    "按拾取鑰匙再按打開木門顯示「木門：已開」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "拾取鑰匙"
     },
     {
      "action": "click",
      "role": "button",
      "name": "打開木門"
     }
    ],
    {
     "kind": "text_appears",
     "text": "木門：已開"
    }
   ],
   [
    "win",
    "依序按拾取鑰匙、打開木門、走向出口顯示「逃脫成功」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "拾取鑰匙"
     },
     {
      "action": "click",
      "role": "button",
      "name": "打開木門"
     },
     {
      "action": "click",
      "role": "button",
      "name": "走向出口"
     }
    ],
    {
     "kind": "text_appears",
     "text": "逃脫成功"
    }
   ],
   [
    "reset",
    "按拾取鑰匙再按重新開始顯示「鑰匙：未持有」",
    [
     {
      "action": "click",
      "role": "button",
      "name": "拾取鑰匙"
     },
     {
      "action": "click",
      "role": "button",
      "name": "重新開始"
     }
    ],
    {
     "kind": "text_appears",
     "text": "鑰匙：未持有"
    }
   ]
  ],
  "guest": [
   {
    "action": "expect",
    "args": [
     "鑰匙：未持有"
    ]
   },
   {
    "action": "click",
    "args": [
     "走向出口"
    ]
   },
   {
    "action": "absent",
    "args": [
     "逃脫成功"
    ]
   },
   {
    "action": "click",
    "args": [
     "打開木門"
    ]
   },
   {
    "action": "expect",
    "args": [
     "需要鑰匙"
    ]
   },
   {
    "action": "expect",
    "args": [
     "木門：關閉"
    ]
   },
   {
    "action": "click",
    "args": [
     "拾取鑰匙"
    ]
   },
   {
    "action": "expect",
    "args": [
     "鑰匙：已持有"
    ]
   },
   {
    "action": "click",
    "args": [
     "打開木門"
    ]
   },
   {
    "action": "expect",
    "args": [
     "木門：已開"
    ]
   },
   {
    "action": "click",
    "args": [
     "走向出口"
    ]
   },
   {
    "action": "expect",
    "args": [
     "逃脫成功"
    ]
   },
   {
    "action": "blocked",
    "args": [
     [
      "拾取鑰匙",
      "打開木門",
      "走向出口"
     ]
    ]
   },
   {
    "action": "click",
    "args": [
     "重新開始"
    ]
   },
   {
    "action": "expect",
    "args": [
     "鑰匙：未持有"
    ]
   },
   {
    "action": "expect",
    "args": [
     "木門：關閉"
    ]
   },
   {
    "action": "absent",
    "args": [
     "逃脫成功"
    ]
   },
   {
    "action": "reload",
    "args": []
   },
   {
    "action": "click",
    "args": [
     "拾取鑰匙"
    ]
   },
   {
    "action": "click",
    "args": [
     "打開木門"
    ]
   },
   {
    "action": "click",
    "args": [
     "走向出口"
    ]
   },
   {
    "action": "expect",
    "args": [
     "逃脫成功"
    ]
   }
  ]
 },
 "g15-rps": {
   "id": "g15-rps",
   "title": "雙人猜拳對決",
   "category": "game",
   "prompt": "製作「雙人猜拳對決」。標題顯示「雙人猜拳對決」。這是兩名玩家在同一螢幕依序出拳的三回合猜拳遊戲，甲先、乙後，直到乙出拳前不得揭露甲的選擇。初始顯示「回合：1」「甲分：0」「乙分：0」。六個選擇按鈕固定叫「甲選石頭」「甲選剪刀」「甲選布」「乙選石頭」「乙選剪刀」「乙選布」，另有「下一回合」「重新開始」。按甲選石頭顯示「甲已出拳」；按甲選石頭再按乙選剪刀顯示「甲分：1」及「本回合：甲勝」。按甲選石頭再按乙選布顯示「乙分：1」及「本回合：乙勝」。按甲選石頭再按乙選石頭顯示「本回合：平手」，平手雙方不得得分。出拳前後不得重複計分，乙不得搶先出拳，未比完一回合不可下一回合。完成該回合才能按下一回合，回合顯示從1到2到3；三回合後按累計得分顯示「總冠軍：甲」「總冠軍：乙」或「總冠軍：平手」，不能再改分數或開下一回合。按甲選石頭、乙選剪刀再按重新開始顯示「甲分：0」，同時「回合：1」「乙分：0」，且清除舊回合及冠軍文字。重新整理後可重新開始一局。任何勝負及完成文字必須在實際結果後才出現在可見遊戲結果區，不得在玩法說明或隱藏節點預印QA字串。要由AI自由寫至少三個互相import的src/ TypeScript模組和CSS，可手機真實操作，不得硬編固定成功畫面、外部網路、外部套件、localStorage或模板。",
   "cases": [
     [
       "title",
       "標題顯示「雙人猜拳對決」",
       [],
       {
         "kind": "text_includes",
         "text": "雙人猜拳對決"
       }
     ],
     [
       "initial",
       "初始顯示「回合：1」",
       [],
       {
         "kind": "text_includes",
         "text": "回合：1"
       }
     ],
     [
       "first",
       "按甲選石頭顯示「甲已出拳」",
       [
         {
           "action": "click",
           "role": "button",
           "name": "甲選石頭"
         }
       ],
       {
         "kind": "text_appears",
         "text": "甲已出拳"
       }
     ],
     [
       "a_win",
       "按甲選石頭再按乙選剪刀顯示「甲分：1」",
       [
         {
           "action": "click",
           "role": "button",
           "name": "甲選石頭"
         },
         {
           "action": "click",
           "role": "button",
           "name": "乙選剪刀"
         }
       ],
       {
         "kind": "text_appears",
         "text": "甲分：1"
       }
     ],
     [
       "b_win",
       "按甲選石頭再按乙選布顯示「乙分：1」",
       [
         {
           "action": "click",
           "role": "button",
           "name": "甲選石頭"
         },
         {
           "action": "click",
           "role": "button",
           "name": "乙選布"
         }
       ],
       {
         "kind": "text_appears",
         "text": "乙分：1"
       }
     ],
     [
       "draw",
       "按甲選石頭再按乙選石頭顯示「本回合：平手」",
       [
         {
           "action": "click",
           "role": "button",
           "name": "甲選石頭"
         },
         {
           "action": "click",
           "role": "button",
           "name": "乙選石頭"
         }
       ],
       {
         "kind": "text_appears",
         "text": "本回合：平手"
       }
     ],
     [
       "reset",
       "按甲選石頭、乙選剪刀再按重新開始顯示「甲分：0」",
       [
         {
           "action": "click",
           "role": "button",
           "name": "甲選石頭"
         },
         {
           "action": "click",
           "role": "button",
           "name": "乙選剪刀"
         },
         {
           "action": "click",
           "role": "button",
           "name": "重新開始"
         }
       ],
       {
         "kind": "text_appears",
         "text": "甲分：0"
       }
     ]
   ],
   "guest": [
     {
       "action": "expect",
       "args": [
         "回合：1"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲分：0"
       ]
     },
     {
       "action": "expect",
       "args": [
         "乙分：0"
       ]
     },
     {
       "action": "click",
       "args": [
         "甲選石頭"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲已出拳"
       ]
     },
     {
       "action": "click",
       "args": [
         "乙選剪刀"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲分：1"
       ]
     },
     {
       "action": "expect",
       "args": [
         "本回合：甲勝"
       ]
     },
     {
       "action": "click",
       "args": [
         "下一回合"
       ]
     },
     {
       "action": "expect",
       "args": [
         "回合：2"
       ]
     },
     {
       "action": "click",
       "args": [
         "甲選布"
       ]
     },
     {
       "action": "click",
       "args": [
         "乙選石頭"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲分：2"
       ]
     },
     {
       "action": "click",
       "args": [
         "下一回合"
       ]
     },
     {
       "action": "expect",
       "args": [
         "回合：3"
       ]
     },
     {
       "action": "click",
       "args": [
         "甲選剪刀"
       ]
     },
     {
       "action": "click",
       "args": [
         "乙選布"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲分：3"
       ]
     },
     {
       "action": "expect",
       "args": [
         "總冠軍：甲"
       ]
     },
     {
       "action": "blocked",
       "args": [
         [
           "甲選石頭",
           "乙選布",
           "下一回合"
         ]
       ]
     },
     {
       "action": "click",
       "args": [
         "重新開始"
       ]
     },
     {
       "action": "expect",
       "args": [
         "回合：1"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲分：0"
       ]
     },
     {
       "action": "expect",
       "args": [
         "乙分：0"
       ]
     },
     {
       "action": "absent",
       "args": [
         "總冠軍：甲"
       ]
     },
     {
       "action": "click",
       "args": [
         "甲選石頭"
       ]
     },
     {
       "action": "click",
       "args": [
         "乙選布"
       ]
     },
     {
       "action": "expect",
       "args": [
         "乙分：1"
       ]
     },
     {
       "action": "expect",
       "args": [
         "本回合：乙勝"
       ]
     },
     {
       "action": "click",
       "args": [
         "下一回合"
       ]
     },
     {
       "action": "click",
       "args": [
         "甲選石頭"
       ]
     },
     {
       "action": "click",
       "args": [
         "乙選石頭"
       ]
     },
     {
       "action": "expect",
       "args": [
         "本回合：平手"
       ]
     },
     {
       "action": "expect",
       "args": [
         "乙分：1"
       ]
     },
     {
       "action": "reload",
       "args": []
     },
     {
       "action": "click",
       "args": [
         "甲選石頭"
       ]
     },
     {
       "action": "click",
       "args": [
         "乙選剪刀"
       ]
     },
     {
       "action": "expect",
       "args": [
         "甲分：1"
       ]
     }
   ]
 }
};
