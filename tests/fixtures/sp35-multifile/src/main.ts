import {add} from "./math";
const root=document.getElementById("app");
if(!root)throw Error("MISSING_ROOT");
const button=document.createElement("button");
button.textContent="Add";
const output=document.createElement("output");
output.id="result";
output.textContent="0";
button.addEventListener("click",()=>{
 output.textContent="APPF2_MULTIFILE_COMPILED_"+add(19,23);
});
root.append(button,output);
