import {describe,it,expect} from "vitest";
import {validFreeImportInput} from "../../src/edge/agent-import-files.js";
const owner="f5ecff92-eae8-43ed-b1da-e45d9e3a125d",hash="sha256:"+"a".repeat(64);
const input={anonymous_id:owner,expected_revision:0,expected_project_hash:hash,
 files:[{path:"src/main.ts",content:"console.log('manual free CI fixture')"}]};
describe("SP35 owner-proven ZERO-CHARGE source import admission",()=>{
 it("accepts bounded source from real creator, never as AI output",()=>{
  expect(validFreeImportInput(input)).toBe(true);
  expect(validFreeImportInput({...input,expected_revision:1})).toBe(false);
  expect(validFreeImportInput({...input,foo:"unexpected"})).toBe(false);
  expect(validFreeImportInput({...input,files:[{path:"package.json",content:"{}"}]})).toBe(false);
  expect(validFreeImportInput({...input,files:[{path:"../escape",content:"x"}]})).toBe(false);
  expect(validFreeImportInput({...input,files:[{path:".github/workflows/a.yml",content:"x"}]})).toBe(false);
  expect(validFreeImportInput({...input,files:[...input.files,...input.files]})).toBe(false);
  expect(validFreeImportInput({...input,files:[{path:"src/main.ts",content:"x".repeat(65537)}]})).toBe(false);
 });
});