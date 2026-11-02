import {describe,it,expect} from "vitest";
import {validCodeRecordInput} from "../../src/edge/code-app-records.js";
import {validRecordQueryFilters} from "../../src/platform/blueprint/code-record-query.js";
const id="6bd142ea-98fb-47d7-becb-a4af16f52e77";
describe("C1 isolated App record API contract",()=>{
 it("admits all four bounded record operations",()=>{
  for(const action of ["create","update"])
   expect(validCodeRecordInput({action,record_id:id,value:{count:2}})).toBe(true);
  for(const action of ["read","delete"])
   expect(validCodeRecordInput({action,record_id:id})).toBe(true);
  expect(validCodeRecordInput({action:"list"})).toBe(true);
 });
 it("unknown business schema JSONB filter exact-match and bounds",()=>{
  for(const filters of [
   {status:"open"},{status:"open",priority:2},{approved:false,score:0,phase:"draft"}
  ]){
   expect(validRecordQueryFilters(filters)).toBe(true);
   expect(validCodeRecordInput({action:"query",filters,limit:20})).toBe(true);
  }
  for(const filters of [{}, {status:[]}, {status:null}, {status:{eq:1}},
   {status:"a".repeat(129)}, {priority:1.5}, {priority:1e15},
   {"$where":"admin"}, {"status;DROP TABLE":"ready"},
   {a:1,b:2,c:3,d:4,e:5}
  ])expect(validRecordQueryFilters(filters)).toBe(false);
  for(const input of [
   {action:"query",filters:{status:"open"},limit:0},
   {action:"query",filters:{status:"open"},limit:101},
   {action:"query",filters:{status:"open"},limit:1,sql:"SELECT"},
   {action:"query",filters:{status:"open"},limit:1.5},
   {action:"query",filters:{status:"open"},limit:10,record_id:id},
   {action:"query",filters:{status:"open"},limit:"10"}
  ])expect(validCodeRecordInput(input)).toBe(false);
 });
 it("rejects SQL injection, unbounded and extra fields",()=>{
  expect(validCodeRecordInput({action:"update",record_id:"x",value:{a:1}})).toBe(false);
  expect(validCodeRecordInput({action:"create",record_id:id,value:{"data":"a".repeat(5000)}})).toBe(false);
  expect(validCodeRecordInput({action:"list",other:"secret"})).toBe(false);
  expect(validCodeRecordInput({action:"read",record_id:id,value:{}})).toBe(false);
 });
});
