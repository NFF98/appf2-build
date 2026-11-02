import {describe,it,expect} from "vitest";
import {operationOf} from "../../src/app/runtime/code-record-bridge.js";
const id="399a0c20-3e33-4802-a8b8-d20ad46b817d";

describe("Opaque iframe -> trusted signed record bridge CAS grammar",()=>{
 it("keeps existing create(value) and permits stable-ID replay of same user intent",()=>{
  const a=operationOf({action:"create",value:{memo:"hello"}});
  expect(a?.action).toBe("create");
  expect(a?.record_id).toMatch(/^[0-9a-f-]{36}$/u);
  expect(operationOf({action:"create",record_id:id,value:{memo:"hello"}})).toEqual({
   action:"create",record_id:id,value:{memo:"hello"}
  });
  expect(operationOf({action:"create",record_id:"other",value:{memo:"hello"}})).toBeNull();
  expect(operationOf({action:"create",record_id:id,value:{memo:"hello"},expected_value:{memo:"x"}})).toBeNull();
 });
 it("passes bounded exact old-version JSON only for update/delete; never guest identity",()=>{
  expect(operationOf({action:"update",record_id:id,value:{count:2},
   expected_value:{count:1},secret_sql:"DROP TABLE",share_id:"forged"})).toEqual({
    action:"update",record_id:id,value:{count:2},expected_value:{count:1}
   });
  expect(operationOf({action:"delete",record_id:id,expected_value:{count:2}})).toEqual({
   action:"delete",record_id:id,expected_value:{count:2}
  });
  expect(operationOf({action:"update",record_id:id,value:{count:2}})).toEqual({
   action:"update",record_id:id,value:{count:2}
  });
  expect(operationOf({action:"delete",record_id:id,expected_value:"fakeVersion"})).toBeNull();
  expect(operationOf({action:"update",record_id:id,value:{x:1},
   expected_value:{blob:"z".repeat(5000)}})).toBeNull();
 });
});