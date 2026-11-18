// Shared navigation guard. A closed/replaced form never keeps the app dirty.
import { confirmDialog, toast } from './components.js';
const forms = new Set();
let confirmation;
let generation=0;
function active() {
  return [...forms].filter(entry => {
    if(entry.element?.isConnected===false){forms.delete(entry);return false;}
    return !entry.isActive || entry.isActive();
  });
}
export function registerUnsaved({element,isDirty,isActive,isSaving}) {
  const entry={element,isDirty,isActive,isSaving};forms.add(entry);
  return ()=>forms.delete(entry);
}
export function hasUnsavedChanges(){return active().some(entry=>entry.isDirty?.() || entry.isSaving?.());}
export function clearUnsavedChanges(){forms.clear();generation++;confirmation=null;}
export async function confirmLeave(){
  if(active().some(entry=>entry.isSaving?.())){toast('Please wait for this record to finish saving.');return false;}
  if(!hasUnsavedChanges())return true;
  const context=generation;
  if(!confirmation){const pending=confirmDialog({title:'Discard unsaved changes?',text:'The changes in this form have not been saved.',confirmLabel:'Discard changes',danger:true}).finally(()=>{if(confirmation===pending)confirmation=null;});confirmation=pending;}
  const confirmed=await confirmation;return context===generation&&confirmed;
}
