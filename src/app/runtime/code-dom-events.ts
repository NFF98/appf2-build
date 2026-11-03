/** Restore local form submit EVENTS without granting native form/network permissions.
 * The iframe remains opaque allow-scripts only, with form-action/connect-src none.
 * No App-specific selector, calculation, endpoint, credential or source rewrite.
 */
export const CODE_DOM_EVENT_SCRIPT=`(()=>{
 "use strict";
 document.addEventListener("click",event=>{
  if(event.defaultPrevented||!(event.target instanceof Element))return;
  const button=event.target.closest("button,input");
  if(!(button instanceof HTMLButtonElement||button instanceof HTMLInputElement)||
   button.disabled||button.type!=="submit"||!button.form)return;
  const form=button.form;
  event.preventDefault();
  if(!form.noValidate&&!button.formNoValidate&&!form.reportValidity())return;
  form.dispatchEvent(new SubmitEvent("submit",{
   bubbles:true,cancelable:true,submitter:button
  }));
 });
})();`;
