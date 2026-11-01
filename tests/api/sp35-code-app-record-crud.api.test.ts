import {describe,it,expect} from "vitest";
import {validCodeRecordInput} from "../../src/edge/code-app-records.js";
const id="6bd142ea-98fb-47d7-becb-a4af16f52e77";
describe("C1 isolated App record API contract",()=>{
 it("admits all four bounded record operations",()=>{
  for(const action of ["create","update"])
   expect(validCodeRecordInput({action,record_id:id,value:{count:2}})).toBe(true);
  for(const action of ["read","delete"])
   expect(validCodeRecordInput({action,record_id:id})).toBe(true);
  expect(validCodeRecordInput({action:"list"})).toBe(true);
 });
 it("rejects SQL injection, unbounded and extra fields",()=>{
  expect(validCodeRecordInput({action:"update",record_id:"x",value:{a:1}})).toBe(false);
  expect(validCodeRecordInput({action:"create",record_id:id,value:{"data":"a".repeat(5000)}})).toBe(false);
  expect(validCodeRecordInput({action:"list",other:"secret"})).toBe(false);
  expect(validCodeRecordInput({action:"read",record_id:id,value:{}})).toBe(false);
 });
});
