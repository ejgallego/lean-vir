/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

export const browserRunnerCaseSpecs = [
  {
    packageFile: "local-quickstart.irpkg",
    entryName: "Quickstart.total",
    expected: {
      entryCount: 6,
      input: "[]",
      inputTags: ["TEXTAREA"],
      runInputs: ["[2,3,5,8]"],
      result: "18",
    },
  },
  {
    packageFile: "local-fib.irpkg",
    entryName: "fib",
    expected: {
      entryCount: 1,
      input: "0",
      runInput: "12",
      result: "144",
    },
  },
  {
    packageFile: "local-mergesort.irpkg",
    entryName: "SortDemo.demoFromArray",
    expected: {
      entryCount: 2,
      input: "[]",
      runInput: "[4, 1, 3, 2]",
      result: "30",
    },
  },
  {
    packageFile: "demo-host.irpkg",
    entryName: "HostInterop.titleHandshake",
    expected: {
      input: "",
      runInput: "pages smoke",
      result: "Lean VIR host: pages smoke",
      documentTitle: "Lean VIR host: pages smoke",
    },
  },
  {
    packageFile: "demo-host.irpkg",
    entryName: "Tamagotchi.uiStep",
    expected: {
      inputTags: ["TEXTAREA", "SELECT"],
      runInputs: [
        `{"name":"Mochi","mood":"happy","trace":["happy"],"artwork":"pet","turns":0,"care":3}`,
        "ignore",
      ],
      result: `{
  "name": "Mochi",
  "mood": "hungry",
  "trace": [
    "happy",
    "hungry"
  ],
  "artwork": "pet",
  "turns": "1",
  "care": "2"
}`,
    },
  },
  {
    packageFile: "fixtures-lean.irpkg",
    entryName: "Vir.Fixtures.ExprPrinter.exprKindScore",
    expected: {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"bvar","index":4}`],
      result: "5",
    },
  },
  {
    packageFile: "pretty-printer.irpkg",
    entryName: "Vir.Fixtures.FormatPretty.formatPrettyCaseAtWidth",
    expected: {
      inputTags: ["SELECT", "INPUT"],
      runInputs: ["list", "12"],
      result: "[alpha,\n beta,\n gamma]",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.arrayStringTotalLength",
    expected: {
      input: "[]",
      inputTags: ["TEXTAREA"],
      runInputs: [`["a","bc"]`],
      result: "3",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.ListOption.classifySum",
    expected: {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["4"],
      result: `{
  "kind": "inr",
  "value": "4"
}`,
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.ListOption.sumScore",
    expected: {
      input: `{"kind":"inl","value":0}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"inr","value":7}`],
      result: "70",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.uint32Bump",
    expected: {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["41"],
      result: "42",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.uint64Bump",
    expected: {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["18446744073709551615"],
      result: "0",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.floatScale",
    expected: {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["1.5"],
      result: "6",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.float32Roundtrip",
    expected: {
      input: "0",
      inputTags: ["INPUT"],
      runInputs: ["1.25"],
      result: "1.25",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.profileStatsBump",
    expected: {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"enabled":true,"level":2,"score16":30,"visits":400,"quota":5,"checksum":6000,"tier":"pro","note":"ok"}`],
      result: `{
  "enabled": false,
  "level": 3,
  "score16": 32,
  "visits": 403,
  "quota": "9",
  "checksum": "6005",
  "tier": "elite",
  "note": "ok!"
}`,
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.boxNatBump",
    expected: {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"value":41}`],
      result: `{
  "value": "42"
}`,
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.boxUInt32Bump",
    expected: {
      input: `{"value":0}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"value":41}`],
      result: `{
  "value": 42
}`,
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.uint32BoxBump",
    expected: {
      input: `{"value":0}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"value":41}`],
      result: `{
  "value": 42
}`,
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.InterfaceShapes.extendedProfileBump",
    expected: {
      input: `{"nickname":"","active":false,"visits":0,"score":0,"tags":[]}`,
      inputTags: ["TEXTAREA"],
      runInputs: [`{"nickname":"lean","active":true,"visits":5,"score":7,"tags":["ir"]}`],
      result: `{
  "nickname": "lean!",
  "active": false,
  "visits": 6,
  "score": "8",
  "tags": [
    "ir",
    "extended"
  ]
}`,
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.RecursiveTypes.treeRootScore",
    expected: {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"branch","fields":{"left":{"kind":"leaf","value":4},"right":{"kind":"branch","fields":{"left":{"kind":"leaf","value":5},"right":{"kind":"leaf","value":6}}}}}`],
      result: "515",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.RecursiveTypes.chainRootScore",
    expected: {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"label":"browser","next":{"label":"leaf","next":null}}`],
      result: "211",
    },
  },
  {
    packageFile: "fixtures-basic.irpkg",
    entryName: "Vir.Fixtures.RecursiveTypes.jsonRootScore",
    expected: {
      inputTags: ["TEXTAREA"],
      runInputs: [`{"kind":"object","value":[{"fst":"flag","snd":{"kind":"bool","value":true}},{"fst":"empty","snd":{"kind":"null"}}]}`],
      result: "22",
    },
  },
  {
    packageFile: "fixtures-boundary.irpkg",
    entryName: "Vir.Fixtures.Boundary.floatScaleScore",
    expected: {
      result: "6",
    },
  },
];

export const browserRunnerFailureSpecs = [
  {
    url: "dev.html?package=bad-magic.irpkg",
    expected: {
      packageName: "...",
      entryCount: 0,
      exports: "...",
      result: /IR package load failed: invalid IR package magic `not-lean-vir`/,
    },
  },
  {
    url: "dev.html?package=unsupported-interface.irpkg",
    expected: {
      packageName: "unsupported-interface.irpkg",
      entryCount: 0,
      result: /package contains unsupported interface exports:[\s\S]*BrowserSmoke\.unsupported/,
    },
  },
];
